# Actual FinTS Importer

A Docker-based importer that connects [Actual Budget](https://actualbudget.org/) to German banks through [FinTS](https://www.fints.org/de/startseite). It supports two ways of importing bank accounts and transactions into Actual.

**Privacy was one of the main reasons I created this project.** I wanted a way to synchronize my bank accounts with Actual Budget without relying on a third-party banking aggregation service.

The importer communicates directly with your bank via FinTS and exchanges financial data with your configured Actual Budget server. No banking data is sent to servers operated by this project, so you remain in control of where your financial data is stored and processed.

> [!IMPORTANT]
> You need a FinTS product registration ID to use this importer. See the official [FinTS product registration page](https://www.fints.org/de/hersteller/produktregistrierung) for details. Not every bank supports FinTS, and the connection details vary by bank.

## Import modes

### SimpleFIN (default)

The importer acts as a local SimpleFIN-compatible server. Because Actual supports SimpleFIN natively, you can link your accounts and trigger bank syncs directly from Actual. You can also use Actual's automatic bank syncing feature, if enabled.

For SimpleFIN support, Actual requires client and server version 24.10.0 or later. See the [Actual SimpleFIN documentation](https://actualbudget.org/docs/advanced/bank-sync/simplefin/).

### API Push (`apipush`)

The importer uses the official Actual API to import accounts and transactions. This was the original implementation and remains available, for example when the importer and Actual run on different machines.

API Push runs when you start the importer. To import new transactions later, run it again manually or schedule it (for example, with cron). This mode does not continuously sync transactions.

When started, API Push connects to your bank and downloads the configured Actual budget. It automatically creates or links bank accounts and account groups in Actual, then imports the fetched transactions.

For newly created accounts, the importer calculates an initial balance adjustment to account for transactions outside the available bank history. This appears as a transaction named `Starting Balance Adjustment`.

The importer also attempts to detect transfers between imported bank accounts and link them as transfers in Actual. If it detects a difference between the imported balance and the bank's reported balance, it prints a warning.

You should review the imported transactions, account balances, and transfers after the first synchronization.

### Bank compatibility

So far, I have only tested this importer with German banks. I haven't found a comprehensive list of supported banks, so you may need to try it with your bank to check compatibility. I have successfully tested it with **GLS**, **DKB** and **UmweltBank**. I think most Volksbanken, Raiffeisenbanken, Gemeinschaftsbanken, and Sparkassen should work as well, but I haven't verified this.

The [FinTS library](https://github.com/schroeer-haren/lib-fints) used in this project has also worked with **ING-DiBa**, **Renault Bank Direkt**, and **comdirect**, but these banks have not yet been tested with this importer.

I've listed the banks I've successfully tested in [this file](docs/working-banks.md). Feel free to extend the list with banks you've successfully tested!

The importer currently supports decoupled TAN authentication methods, where you approve a request through your banking app. Other TAN methods are not currently supported. During synchronization, you may need to approve multiple requests in your bank's app.

## Configuration

The Docker image is `jonesmonez/actualfintsimporter`. Configure it using environment variables. You can use the repository's [`.env.example`](.env.example) as a starting point.

> [!CAUTION]
> The importer needs access to your bank credentials. Passwords and tokens supplied through environment variables or the optional password file are not encrypted by this importer. Protect the host, restrict access to these files, and never commit credentials to version control.

### General environment variables

| Variable | Description | Required / default | Example |
| --- | --- | --- | --- |
| `FINTS_PRODUCT_ID` | Your registered FinTS product ID | Required | `1234567890ABCDEF123456789` |
| `BANKS` | Comma-separated list of bank identifiers used in the variables below | Required | `BANKONE,BANKTWO` |
| `BANKONE_USR` | FinTS username for `BANKONE` | Required for each bank | `BANKUSER` |
| `BANKONE_PIN` | FinTS PIN/password for `BANKONE`. Can also be supplied in the password file | Required for each bank | `BANKPASSWORD` |
| `BANKONE_BLZ` | Bank code (*Bankleitzahl*) for `BANKONE` | Required for each bank | `12340000` |
| `BANKONE_URL` | FinTS endpoint URL for `BANKONE` | Required for each bank | `https://bank.example/fints` |
| `SYNC_MODE` | Import mode: `simplefin` or `apipush` | Optional / `simplefin` | `simplefin` |
| `DB_PATH` | Path to the SQLite database | Optional / `data/bank.db` | `data/bank.db` |
| `FINTS_INITIAL_FETCH_DAYS` | Number of days of transactions to fetch during the **first** synchronization | Optional / `365` | `365` |

Replace `BANKONE` with the identifier you entered in `BANKS`. For multiple banks, add a complete set of variables for each identifier.

### SimpleFIN environment variables

These variables are used in `simplefin`-mode.

| Variable | Description | Required / default | Example |
| --- | --- | --- | --- |
| `SIMPLEFIN_HOST` | Address the SimpleFIN server listens on. Use `0.0.0.0` to accept connections from other containers. | Optional / `127.0.0.1` | `0.0.0.0` |
| `SIMPLEFIN_PORT` | Port the SimpleFIN server listens on | Optional / `3001` | `3001` |
| `SIMPLEFIN_PUBLIC_URL` | Base URL used when generating SimpleFIN tokens. It must be reachable **from the Actual server** and it does not have to be publicly accessible. It must end with `/simplefin`. | Required | `http://actualfintsimporter:3001/simplefin` |
| `SIMPLEFIN_ALLOW_HTTP` | Allow HTTP instead of HTTPS | Optional / `false` | `true` |
| `SIMPLEFIN_ADMIN_TOKEN` | Secret used to authorize creation of SimpleFIN setup tokens. This can be supplied in the password file. It needs to be at least 24 characters long. A token can be generated with `openssl rand -hex 32`. | Required | `REPLACE_WITH_A_RANDOM_SECRET` |

> [!NOTE]
> Actual blocks SimpleFIN connections to private networks by default. If you host this importer on a private network, set `ACTUAL_SIMPLEFIN_ALLOWED_NETWORKS` on the **Actual server** to the importer's IP address and restart Actual. The combined [Docker Compose example](#docker-compose-importer-and-actual-together) below includes this setting. See [Actual's configuration documentation](https://actualbudget.org/docs/config/#actual_simplefin_allowed_networks-configjson-simplefinallowednetworks).
>
> Use HTTP only on a trusted, isolated network. Use HTTPS if credentials would otherwise travel across an untrusted network. **Do not expose this API directly to the internet.**

### API Push environment variables

These variables are used in `apipush`-mode.

| Variable | Description | Required / default | Example |
| --- | --- | --- | --- |
| `ACTUAL_SERVER_URL` | URL of the Actual server, including its port | Required | `http://actual:5006` |
| `ACTUAL_PASSWORD` | Actual server password. Can be supplied in the password file | Required | `ACTUALPASSWORD` |
| `ACTUAL_SYNC_ID` | Sync ID of the Actual budget file | Required | `12345678-9123-4567-abcd-ef1234567890` |
| `ACTUAL_E2E` | End-to-end encryption password/key, if used. Can be supplied in the password file | Optional | `E2EKEYIFUSED` |

### Using a password file

Instead of setting the `*_PIN`, `SIMPLEFIN_ADMIN_TOKEN`, `ACTUAL_PASSWORD`, and `ACTUAL_E2E` variables in `.env`, you can put them in a separate, `.env`-style file mounted at `/run/secrets/app.env` inside the container.

For example, create `app.env`:

```dotenv
BANKONE_PIN=BANKPASSWORD
# Add additional bank PINs here if needed

# Only needed for SimpleFIN:
SIMPLEFIN_ADMIN_TOKEN=abcdef...1234567890
# Only needed for API Push:
ACTUAL_PASSWORD=ACTUALPASSWORD
ACTUAL_E2E=E2EKEYIFUSED
```

## Running the importer

Copy `.env.example` to `.env` and adjust the values for your bank and import mode. If you use a password file, create `app.env` as described above.

> [!NOTE]
> If you provide all credentials through environment variables and don't use a separate password file, remove the app.env volume mapping from the examples.

When running this container you need to mount the `/app/data` directory. It stores the `sqlite3` database which holds the fetched accounts and transactions from your bank. The database also stores account mappings, cached banking information, and SimpleFIN authorization data. Keep the data directory persistent between container restarts and include it in your backups.

The database contains sensitive financial information and should not be publicly accessible. If you delete it, the importer loses its locally stored account information and SimpleFIN credentials. Existing SimpleFIN connections will need to be reauthorized.

For consistent backups, stop the importer before copying the database directory, or use a SQLite-aware backup method.

### Docker Run

Example for SimpleFIN, with the port published **only on the host's loopback interface**:

```bash
docker run -d \
  --name actualfintsimporter \
  --env-file .env \
  -v "$(pwd)/app.env:/run/secrets/app.env:ro" \
  -v "$(pwd)/data:/app/data" \
  -p 127.0.0.1:3001:3001 \
  jonesmonez/actualfintsimporter
```

This port mapping is suitable only if the Actual server can reach the mapped address. If Actual runs in a separate container, connect both containers to a shared Docker network and set `SIMPLEFIN_PUBLIC_URL` to an address Actual can resolve. Set `SIMPLEFIN_HOST=0.0.0.0` for connections from outside the importer container.

For API Push, set `SYNC_MODE=apipush` and run the container when you want to import transactions. Port publishing (`-p`) is not needed in that mode. For a one-off run, replace `-d --name actualfintsimporter` with `--rm`.

### Docker Compose: importer only

The following example publishes the SimpleFIN port to the local host. Adjust the networking if Actual is running in another container or on another machine.

```yaml
services:
  actualfintsimporter:
    container_name: actualfintsimporter
    image: jonesmonez/actualfintsimporter
    env_file:
      - .env
    volumes:
      - ./app.env:/run/secrets/app.env:ro
      - ./data:/app/data
    ports:
      - "127.0.0.1:3001:3001"
```

For API Push, remove the `ports` section and start the container only when a sync is needed.

### Docker Compose: importer and Actual together

This example creates a dedicated Docker network. The importer is accessible to Actual by its service name without publishing the SimpleFIN port on the host.

For this example, make sure your `.env` contains the following SimpleFIN settings in addition to your bank configuration:

```dotenv
SYNC_MODE=simplefin
SIMPLEFIN_HOST=0.0.0.0
SIMPLEFIN_PORT=3001
SIMPLEFIN_PUBLIC_URL=http://actualfintsimporter:3001/simplefin
SIMPLEFIN_ALLOW_HTTP=true
```

```yaml
services:
  actual:
    container_name: actual
    image: docker.io/actualbudget/actual-server:latest
    ports:
      - '5006:5006'
    volumes:
      - ./actual-data:/data
    environment:
      ACTUAL_SIMPLEFIN_ALLOWED_NETWORKS: "172.50.50.10"
    healthcheck:
      test: ['CMD-SHELL', 'node scripts/health-check.js']
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 20s
    restart: unless-stopped
    networks:
      - actual-network

  actualfintsimporter:
    container_name: actualfintsimporter
    image: jonesmonez/actualfintsimporter
    restart: unless-stopped
    depends_on:
      - actual
    env_file:
      - .env
    volumes:
      - ./app.env:/run/secrets/app.env:ro
      - ./data:/app/data
    networks:
      actual-network:
        ipv4_address: 172.50.50.10

networks:
  actual-network:
    name: actual-network
    driver: bridge
    ipam:
      config:
        - subnet: 172.50.50.0/24
```


Start the services:

```bash
docker compose up -d
```

You can check the importer's logs with:

```bash
docker compose logs actualfintsimporter
```

For additional Actual server options, see the [Actual configuration documentation](https://actualbudget.org/docs/config/).

## Connecting SimpleFIN to Actual

With the combined Compose example above, you can run `curl` from a temporary container on the same network:

```bash
docker run --rm \
  --network actual-network \
  curlimages/curl:latest \
  --fail --silent --show-error \
  -H "Authorization: Bearer YOUR_SIMPLEFIN_ADMIN_TOKEN" \
  http://actualfintsimporter:3001/simplefin/create
```

Replace `YOUR_SIMPLEFIN_ADMIN_TOKEN` with the secret configured in `SIMPLEFIN_ADMIN_TOKEN`. If you changed the network name, service name, or port, adjust the command accordingly.

Alternatively, if the API port is reachable from the host:

```bash
curl --fail --silent --show-error \
  -H "Authorization: Bearer YOUR_SIMPLEFIN_ADMIN_TOKEN" \
  http://127.0.0.1:3001/simplefin/create
```

Copy the **SimpleFIN setup token** returned by the command. Treat it like a password. Do not paste real tokens into issues, logs, or documentation examples.

> [!NOTE]
> The generated setup token is only valid for one hour and can only be claimed once.

## Troubleshooting

**Actual cannot connect to the SimpleFIN server**

- Verify that `SIMPLEFIN_PUBLIC_URL` is resolvable and reachable **from the Actual server**, not just from your browser or host.
- If Actual and the importer run in separate containers, check that they share a reachable network and that `SIMPLEFIN_HOST` is set to `0.0.0.0`.
- If using a private IP address, check `ACTUAL_SIMPLEFIN_ALLOWED_NETWORKS` and restart Actual after changing it.
- If using HTTP, check `SIMPLEFIN_ALLOW_HTTP` and make sure the connection stays on a trusted network.

**Docker cannot mount the password file**

- Check that `app.env` exists at the path used in your Docker command or Compose file and is readable by the container.

**Bank connection or authentication fails**

- Verify the FinTS URL, BLZ, username, PIN, and product ID. Some banks may require additional authentication steps so the behavior depends on the bank.

**The API Push importer does not automatically fetch new transactions**

- This is expected: `apipush` needs to be started for each import. Schedule it or run it manually.

## Security notes

- Keep the importer on a trusted network, do not expose its API to the public internet.
- Use strong, unique values for `SIMPLEFIN_ADMIN_TOKEN` and protect generated setup tokens.
- Keep credential files out of version control and restrict access to Docker, the host, and container logs.

### Revoking SimpleFIN access

If you need to revoke access to the SimpleFIN server, you can invalidate all previously generated access credentials using the `/simplefin/revoke` endpoint.

This also invalidates outstanding setup tokens. After revocation, existing SimpleFIN connections will stop working and must be set up again using a new setup token.

The endpoint requires the configured SimpleFIN admin token.

``` bash
curl --fail --silent --show-error \
  -X POST \
  -H "Authorization: Bearer YOUR_SIMPLEFIN_ADMIN_TOKEN" \
  http://127.0.0.1:3001/simplefin/revoke
```

## Useful links

- [Actual Budget](https://actualbudget.org/)
- [Actual SimpleFIN setup](https://actualbudget.org/docs/advanced/bank-sync/simplefin/)
- [Actual server configuration](https://actualbudget.org/docs/config/)
- [FinTS product registration](https://www.fints.org/de/hersteller/produktregistrierung)

## A Note on AI Usage

I used AI tools during development, mainly to answer questions, better understand JavaScript concepts, and help with parts of the SimpleFIN API implementation.

The project is not entirely AI-generated. I've reviewed and tested the code and made an effort to understand how it works.

I'm still learning JavaScript, so there may be parts of the code that could be improved. If you have suggestions, feel free to open an issue or submit a pull request!