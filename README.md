# dogbox

Simple temporary file and paste storage

## Environment variables

- `PORT` - web server listening port
- `STORAGE_PATH` - path to file storage itself (usually something like `/storage` for simple volume mapping)
- `RETENTION_TIME` - retention time for files in milliseconds
- `ACCESS_CONFIG_PATH` - path to access config (for upload/download actions), example is available [in the repo](access-config.example.json)
- `EXTERNAL_URL` - external DogBox url (optional)

## Example `docker-compose.yml`

```yaml
services:
  dogbox:
    build: https://github.com/b4ck5p4c3/dogbox.git
    restart: always
    ports:
      - 127.0.0.1:3000:3000
    environment:
      STORAGE_PATH: /storage
      RETENTION_TIME: 600000
    volumes:
      - ./storage:/storage
```