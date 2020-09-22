module.exports = function(deployer) {
  deployer.deploy(artifacts.require('GTCRFactory'), { gas: 110000000 });
};
