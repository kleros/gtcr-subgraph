<p align="center">
  <b style="font-size: 32px;">Generalized Token Curated List Subgraph</b>
</p>

<p align="center">
  <a href="https://conventionalcommits.org"><img src="https://img.shields.io/badge/Conventional%20Commits-1.0.0-yellow.svg" alt="Conventional Commits"></a>
  <a href="http://commitizen.github.io/cz-cli/"><img src="https://img.shields.io/badge/commitizen-friendly-brightgreen.svg" alt="Commitizen Friendly"></a>
</p>

This repo defines a subgraph which is used by Curate.

The `docker-compose.yml` contains a Docker Compose configuration suitable for spinning up a test environment.

## Testing

If running for the first time (i.e. there aren't any previous containers you want to remove), use:

`docker-compose down && docker-compose up -d && yarn test`.

After that, to teardown and run the tests again:

`docker stop $(docker ps -a -q) && docker rm $(docker ps -a -q) && docker-compose down && docker-compose up -d && yarn test`

> Note: You'll probably need sudo to run those commands.