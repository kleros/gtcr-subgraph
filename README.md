<p align="center">
  <b style="font-size: 32px;">Generalized Token Curated List Subgraph</b>
</p>

<p align="center">
  <a href="https://conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg" alt="Conventional Commits"></a>
  <a href="http://commitizen.github.io/cz-cli/"><img src="https://img.shields.io/badge/commitizen-friendly-brightgreen.svg" alt="Commitizen Friendly"></a>
</p>

This repo defines a subgraph which is used by Curate.

## Dev

To deploy to your own instance on a testnet, modify the script to use your own subgraph instance. For example, change `deploy:kovan` to `graph deploy --product hosted-service <your-username>/curate-kovan`.

To set your access token:
`npx graph auth --product hosted-service <access-token>`

## Curate Subgraph Mini-guide

Pulling data from Kleros Curate hosted subgraph is quite easy! There is just one thing to keep in mind and we'll move to examples:

There are 2 versions of Curate contracts:

1- Curate Classic
2- Curate (sometimes refered to as Light Curate)

See below some important differences between the two versions.

### Curate Classic

This is the original version of Curate, built at a time when block space was not so sought after and fees were low.

- All data (apart from things like images, files, videos, etc) is stored on-chain (storage) which means other contracts can search for item information. This also means it is quite expensive to use today.
- The data is encoded and stored as bytes and needs to be decoded to be presented in the UI.
- Gas usage increases linearly with the complexity of the size of the item.

### Curate (or Light Curate)

Built to be way more efficient and cheap to use than curate classic, specially for large items. 

- Items are stored on IPFS and its URI as logs on-chain;
- Contracts cannot access item data; 
- Submission cost is constant with the size of the item (way cheaper).

### Fetching Items

Something to keep in mind when navigating Curate's subgraph is that Light Curate requires a different set of fields in some entities than Curate Classic. These entities are prepended with an `l`. For example: to fetch Light Curate items, you use the `litems` entity. To fetch a Curate Classic items, the `items` entity and so on.

> Limit: If you want to fetch every single item in a registry with more than 1000 items, you have to fetch in batches as the hosted service has a limit.


For the examples, we'll be using this subgraph: https://thegraph.com/hosted-service/subgraph/eccentricexit/light-curate-kovan-ii?version=pending

#### Registered Items

Here is how to fetch up to 10 most recently accepted items from a light curate list (0x3f6ab2800edfe8fa6865b9f849d1f80e94a903ef) deployed on kovan.

```
// (You can paste this on your browser's console to see it in action)

;(async () => {
const subgraphQuery = {
    query: `
      {
          registered: litems(first: 5, where: { status: Registered, registryAddress: "0x3f6ab2800edfe8fa6865b9f849d1f80e94a903ef" }, orderBy: latestRequestResolutionTime, orderDirection:desc) {    
            props {
              type
              label
              description
              value
            }   
          }
          clearingRequested: litems(first: 5, where: { status: ClearingRequested, registryAddress: "0x3f6ab2800edfe8fa6865b9f849d1f80e94a903ef" }, orderBy: latestRequestResolutionTime, orderDirection:desc) {    
            props {
              type
              label
              description
              value
            }   
          } 
        }
    `
  }
  const subgraphEndpoint = 'https://api.thegraph.com/subgraphs/id/Qmbn6y1QzdJPj9hXpeRrT6L6zVc7uRs9aUehVmK5DnzNip'
  const response = await fetch(subgraphEndpoint, {
    method: 'POST',
    body: JSON.stringify(subgraphQuery)
  })
  const parsedValues = await response.json()
  const { data } = parsedValues || {}

  console.info(data)
  
})()

```

A few key observations:

- Addresses in subgraphs are stored as bytes and queried as hex strings. It does not know what an ethereum checksummed address is so you MUST lowercase it when querying otherwise it wont find it.
- Items with the status "ClearingRequested" are registered until the request goes through (successfully) so we include those in the results.

#### Recent Requests

For any TCR, you want to make it as easy as possible for challenger to scrutinize attempts to add or remove items from the list. The way to do this is to display items in the challenge period (i.e. items being added or being removed from the list).

See below how to fetch the items in the challenge period, ordered by closest to the deadline.

```
// (You can paste this on your browser's console to see it in action)

;(async () => {
const subgraphQuery = {
    query: `
          lrequests(first: 5, where: { resolved: false, registryAddress: "0x3f6ab2800edfe8fa6865b9f849d1f80e94a903ef" }, orderBy: submissionTime, orderDirection: desc) {
        item {
          props {
            type
            label
            description
            value
          }
        }
      }
    `
  }
  const subgraphEndpoint = 'https://api.thegraph.com/subgraphs/id/Qmbn6y1QzdJPj9hXpeRrT6L6zVc7uRs9aUehVmK5DnzNip'
  const response = await fetch(subgraphEndpoint, {
    method: 'POST',
    body: JSON.stringify(subgraphQuery)
  })
  const parsedValues = await response.json()
  const { data } = parsedValues || {}

  console.info(data)
  
})()
```
