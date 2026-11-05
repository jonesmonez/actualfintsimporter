import { FinTSClient, FinTSConfig } from '@schroeer-haren/lib-fints';
// import { FinTSClient, FinTSConfig } from 'lib-fints';

import { getLogger } from './logger.js';
const log = getLogger('fints');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class FinTSHandler {
    #config;
    constructor({
        user,
        pin,
        blz,
        url,
        pid,
        bank,
    },
        saveBankingInfoCallback,
    ) {
        this.user = user;
        this.pin = pin;
        this.blz = blz;
        this.fintsUrl = url;
        this.pid = pid;
        this.ver = '1.0';
        this.bankAbr = bank;


        this.saveCallback = saveBankingInfoCallback;

        if (!this.user || !this.pin) {
            throw new Error(`${this.bankAbr}_USER and ${this.bankAbr}_PIN must be set`);
        }

        this.client = null;
        this.#config = null;

        this.bank_name = null;

        this.tanMethod = null;
        this.tanFirstPollWaitMs = 2000;
        this.tanPollIntervalMs = 2000;
        this.tanMaxPolls = 150;
    }

    async connect(bankConn) {
        if (bankConn) {
            this.#config = FinTSConfig.fromBankingInformation(
                this.pid,
                this.ver,
                bankConn,
                this.user,
                this.pin,
            );
        } else {
            this.#config = FinTSConfig.forFirstTimeUse(
                this.pid,
                this.ver,
                this.fintsUrl,
                this.blz,
                this.user,
                this.pin
            );
        }

        this.client = new FinTSClient(this.#config);

        await this.#processRespone(
            await this.client.synchronize(),
            ref => this.client.synchronizeWithTan(ref),
            'Login'
        );

        this.#selectTanMethod();

        await this.#processRespone(
            await this.client.synchronize(),
            ref => this.client.synchronizeWithTan(ref),
            'Login'
        );

        this.bank_name = this.getBank();

        log.info('FinTS connected')

        if (!bankConn) {
            await this.saveCallback(this.#config.bankingInformation);
        }
    }

    #selectTanMethod() {
        const methods = this.client.config.availableTanMethods;
        if (!methods?.length) {
            throw new Error('Bank did not provide any TAN methods');
        }

        const method = methods.find(
            method => method.isDecoupled === true
        );

        if (!method) {
            throw new Error('No decoupled TAN method available');
        }

        this.tanMethod = method;

        this.client.selectTanMethod(
            method.id
        );

        const decoupled = method.decoupled;
        this.tanFirstPollWaitMs = (decoupled?.waitingSecondsBeforeFirstStatusRequest ?? method.waitBeforeNextPoll ?? 2) * 1000;
        this.tanPollIntervalMs = (decoupled?.waitingSecondsBetweenStatusRequests ?? method.waitBeforeNextPoll ?? 2) * 1000;
        this.tanMaxPolls = decoupled?.maxStatusRequests ?? method.decoupledMaxPollNumber ?? 150;
    }

    getBank() {
        this.#checkConnection();
        let response = this.client.config.bankingInformation.bpd.bankName;
        return response;
    }

    getBankAbr() {
        this.#checkConnection();
        return this.bankAbr;
    }

    async #processRespone(response, withTan, reason) {
        if (!response) {
            throw new Error('Empty FinTS response');
        }

        if (response.requiresTan) {
            response = await this.#handleDecoupledTan(response, withTan, reason);
        }

        if (!response?.success || response.requiresTan) {
            const errors = (response?.bankAnswers ?? [])
                .map(answer =>
                    `${answer.code}: ${answer.text ?? answer.message ?? 'Unknown'}`
                )
                .join(' | ');

            throw new Error(
                `FinTS request failed for ${this.bankAbr}: ` +
                (errors || 'No bank error details available')
            );
        }

        return this.#saveBankingInformation(response);
    }

    async #handleDecoupledTan(initialResponse, withTan, reason) {
        let response = initialResponse;
        let tanReference = response.tanReference;

        if (!tanReference) {
            throw new Error('TAN required, but no tanReference was returned');
        }

        let tanText = `${this.bankAbr} requires TAN approval for ${reason}: ${response.tanChallenge}`;
        if (response.tanMediaName) {
            tanText += ` (${response.tanMediaName})`;
        }

        log.info(tanText);

        for (let poll = 1; poll <= this.tanMaxPolls; poll++) {
            const progress = Math.round((poll / this.tanMaxPolls) * 100);
            const barLength = 40;
            const filled = Math.round((progress / 100) * barLength);
            const padding = Math.abs(this.tanMaxPolls).toString().length - Math.abs(poll).toString().length;

            log.progress(
                `Waiting for approval [${'='.repeat(filled)}${' '.repeat(barLength - filled)}] ${'0'.repeat(padding)}${poll}/${this.tanMaxPolls}`
            );

            await sleep(poll === 1 ? this.tanFirstPollWaitMs : this.tanPollIntervalMs);
            response = await withTan(tanReference);
            if (!response) {
                throw new Error('No response while waiting for TAN approval');
            }

            tanReference = response.tanReference ?? tanReference;

            if (!response.requiresTan) {
                if (!response.success) {
                    throw new Error(`TAN approval/request failed for ${this.bankAbr}`);
                }
                log.endProgress('Approval received!');
                return response;
            }
        }
        throw new Error('Confirmation timed out');
    }

    async getAccounts() {
        this.#checkConnection();
        let response = await this.client.config.bankingInformation.upd.bankAccounts;
        return response;
    }

    async getBalance(account) {
        this.#checkConnection();
        const response = await this.client.getAccountBalance(account.accountNumber);

        return this.#processRespone(
            response,
            ref => this.client.getAccountBalanceWithTan(ref),
            'Balance'
        );
    }

    async getStatements(account, from, to) {
        this.#checkConnection();
        const response = await this.client.getAccountStatements(account.accountNumber, from, to);

        return this.#processRespone(
            response,
            ref => this.client.getAccountStatementsWithTan(ref),
            'Transactions'
        );
    }

    #checkConnection() {
        if (!this.client) {
            throw new Error('FinTSHandler is not connected, call connected() first')
        }
    }

    async #saveBankingInformation(response) {
        if (response.bankingInformationUpdated) {
            log.debug('Updating saved banking informations');
            await this.saveCallback(this.#config.bankingInformation);
        }
        return response;
    }
}