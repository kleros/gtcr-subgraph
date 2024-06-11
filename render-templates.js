const fs = require('fs-extra');
const mustache = require('mustache');

const chainNameToChainId = {
  gnosis: 100,
  mainnet: 1,
  goerli: 5,
  sepolia: 11155111,
};

async function main() {
  const networkName = process.argv[2];
  const chainId = chainNameToChainId[networkName];
  const deployments = JSON.parse(fs.readFileSync('networks.json', 'utf8'));
  const { address: lgtcrFactoryAddr, startBlock: lgtcrFactoryStartBlock } =
    deployments['LightGTCRFactory'][chainId];
  const { address: gtcrFactoryAddr, startBlock: gtcrFactoryStartBlock } =
    deployments['GTCRFactory'][chainId];
  const templateData = {
    network: networkName,
  };
  templateData['LightGTCRFactory'] = {
    address: lgtcrFactoryAddr,
    addressLowerCase: lgtcrFactoryAddr.toLowerCase(),
    startBlock: lgtcrFactoryStartBlock,
  };
  templateData['GTCRFactory'] = {
    address: gtcrFactoryAddr,
    addressLowerCase: gtcrFactoryAddr.toLowerCase(),
    startBlock: gtcrFactoryStartBlock,
  };

  for (const templatedFileDesc of [['subgraph', 'yaml']]) {
    const template = fs
      .readFileSync(`${templatedFileDesc[0]}.template.${templatedFileDesc[1]}`)
      .toString();
    fs.writeFileSync(
      `${templatedFileDesc[0]}.${templatedFileDesc[1]}`,
      mustache.render(template, templateData),
    );
  }
}

main();
