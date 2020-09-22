const seed = process.env.SEED || 'home vapor crisp idea clock oblige frozen bubble rare law risk torch';
const HDWalletProvider = require('@truffle/hdwallet-provider');

const networks = Object.assign(...[
  [1, 'mainnet'],
  [3, 'ropsten'],
  [4, 'rinkeby'],
  [5, 'goerli', `${2e9}`],
  [42, 'kovan'],
].map(([networkId, network, gasPrice]) => ({
  [network]: {
    network_id: networkId,
    gasPrice,
    provider: () => new HDWalletProvider(
      seed,
      `https://${network}.infura.io/v3/${process.env.PROJECT_KEY}`,
    ),
  },
})), {
  development: {
    host: 'localhost',
    port: 8545,
    network_id: '*',
  },
  compilers: {
    solc: {
      version: "^0.5.17",
      settings: {
        optimizer: {
          enabled: true,
          runs: 200   // Optimize for how many times you intend to run the code
        }
      }
    },
  },
});

module.exports = { networks };
