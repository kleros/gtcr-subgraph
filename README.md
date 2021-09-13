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
