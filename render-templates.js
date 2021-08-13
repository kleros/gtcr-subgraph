const fs = require('fs-extra');
const mustache = require('mustache');

const chainNameToChainId = {
  xdai: 100,
  mainnet: 1,
  kovan: 42,
  rinkeby: 4
}

async function main() {
  const networkName = process.argv[2]
  const chainId = chainNameToChainId[networkName]
  const deployments = JSON.parse(fs.readFileSync('networks.json', 'utf8'));
  const { address, startBlock } = deployments['LightGTCRFactory'][chainId]
  const templateData = {
    network: networkName
  };
  templateData['LightGTCRFactory'] = {
    address,
    addressLowerCase: address.toLowerCase(),
    startBlock,
  };

  for (const templatedFileDesc of [
    ['subgraph', 'yaml']
  ]) {
    const template = fs.readFileSync(`${templatedFileDesc[0]}.template.${templatedFileDesc[1]}`).toString();
    fs.writeFileSync(
      `${templatedFileDesc[0]}.${templatedFileDesc[1]}`,
      mustache.render(template, templateData),
    );
  }
}

main()

