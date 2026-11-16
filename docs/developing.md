## Development with Docker

The repository includes a Docker Compose development environment with Actual Budget, the FinTS importer, and Caddy.

### Start development

```bash
docker compose -f test/compose.yaml up --build --watch
```

Docker Compose Watch automatically synchronizes source-code changes and restarts the importer. Changes to dependencies or the Dockerfile trigger a rebuild.

The Actual Budget server is accessible at [https://localhost:8443/](https://localhost:8443/) through Caddy. Depending on your local certificate configuration, your browser may display a certificate warning.

The FinTS importer is only accessible within the Docker network. For debugging or manual API requests, you can access it using a [temporary container](../README.md#connecting-simplefin-to-actual).

### Restart the importer

To restart the importer without rebuilding the image or deleting data:

```bash
docker compose -f test/compose.yaml restart actualfintsimporter
```

### Reset development data

To simulate a fresh installation, stop the development environment and remove or archive the contents of the development-only importer and Actual Budget data directories before starting the containers again.

The data directories are bind-mounted and therefore persist across container restarts and recreation.

**Warning:** Never reset production data. Make sure the development Compose file uses separate data directories.

### Stop development

```bash
docker compose -f test/compose.yaml down
```