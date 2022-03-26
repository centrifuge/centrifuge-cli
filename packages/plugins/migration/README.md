# Centrifuge Migration Plugin
The migration plugin can be used to migrate data from a stand-alone to a parachain. 
This plugin will probably only be used for the migration of chain-data to our Kusama and Polkadot
parachains.

## How to Use
The plugin expects a few parameters to be provided as also two json-files defining the migration
itself.

### Arguments
1. The ws-endpoint from where the data shall be fetched
2. The ws-endpoint to where the data shall be migrated
### Flags
* -b/--block : Defines the blocknumber the state is fetched at. If not defined latest is used.
* --config : Defines the modules and the sequence of migration for them. 
  
    Example for Altair:
    ```json
    {
      "modules": [
        {
          "name": "Vesting",
          "item": {
            "name": "Vesting"
          }
        },
        {
          "name": "Proxy",
          "item": {
            "name": "Proxies"
          }
        },{
          "name": "Balances",
          "item": {
            "name": "TotalIssuance"
          }
        },
        {
          "name": "System",
          "item": {
            "name": "Account"
          }
        }
      ],
      "sequence": [
        {
          "name": "Balances",
          "item": "TotalIssuance"
        },
        {
          "name": "System",
          "item": "Account"
        },
        {
          "name": "Proxy",
          "item": "Proxies"
        },
        {
          "name": "Vesting",
          "item": "Vesting"
        }
      ]
    }
    ```
* --creds : Credentials that will be used to execute the extriniscs. I.e. the root-key.
    ```json
    {
    "rawSeed": "//Alice"
    }
    ```
* --verify : If flag is given, the migration will be verified directly afterwards.
* --just-verify : This option expects a path to a json file of the following form in order to verify a past migration.
    ```json
    export interface MigrationSummary {
      fromFetchedAt: string,
      fromStartedAt: string,
      toStartedAt: string
      toEndAt: string,
    }
    ```
  
* --finalize : If flag is present, then the call-filters will be disabled after the migration.

An exemplary command will look like this:
```shell
migration \
  wss://fullnode-archive.centrifuge.io \ 
  ws://127.0.0.1:9946 \
  -b 6650475 \
  --config ./packages/plugins/migration/configs/altair-migration.json \ 
  --creds ./packages/plugins/migration/configs/creds.json \
  --verify
```
