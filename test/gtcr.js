
/* global describe, it, before, step */
const Web3 = require('web3')
const TruffleContract = require('@truffle/contract')
const { default: axios } = require('axios')
const delay = require('delay')
const fs = require('fs-extra')
const path = require('path')
const { gtcrEncode, ItemTypes } = require('@kleros/gtcr-encoder')
const { expect } = require('chai')
const { promisify } = require('util')
const _GeneralizedTCR = require('../build/contracts/GeneralizedTCR.json')

const provider = new Web3.providers.HttpProvider('http://localhost:8545')
const web3 = new Web3(provider)

function getContract (contractName) {
  const C = TruffleContract(fs.readJsonSync(path.join(
    __dirname, '..', 'build', 'contracts', `${contractName}.json`
  )))
  C.setProvider(provider)
  return C
}

const SimpleCentralizedArbitrator = getContract('SimpleCentralizedArbitrator')
const GeneralizedTCR = getContract('GeneralizedTCR')

async function queryGraph (query) {
  return (await axios.post('http://localhost:8000/subgraphs', { query })).data.data
}

const subgraphName = 'kleros/gtcr'

async function querySubgraph (query) {
  return (await axios.post(`http://localhost:8000/subgraphs/name/${subgraphName}`, { query })).data.data
}

async function waitForGraphSync (targetBlockNumber) {
  if (targetBlockNumber == null) { targetBlockNumber = await web3.eth.getBlockNumber() }

  while (true) {
    await delay(100)
    const {
      subgraphs: [{
        currentVersion: {
          id: currentVersionId,
          deployment: {
            latestEthereumBlockNumber
          }
        },
        versions: [{ id: latestVersionId }]
      }]
    } = await queryGraph(`{
      subgraphs(
        where: {name: "${subgraphName}"}
        first: 1
      ) {
        currentVersion {
          id
          deployment {
            latestEthereumBlockNumber
          }
        }
        versions(
          orderBy: createdAt,
          orderDirection: desc,
          first: 1
        ) {
          id
        }
      }
    }`)

    if (
      currentVersionId === latestVersionId &&
      latestEthereumBlockNumber === targetBlockNumber
    ) { break }
  }
}

/** Increases ganache time by the passed duration in seconds and mines a block.
 * @param {number} duration time in seconds
 */
async function increaseTime (duration) {
  await promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_increaseTime',
    params: [duration],
    id: new Date().getTime()
  })

  await advanceBlock()
}

/** Advance to next mined block using `evm_mine`
 * @returns {promise} Promise that block is mined
 */
function advanceBlock () {
  return promisify(web3.currentProvider.send.bind(web3.currentProvider))({
    jsonrpc: '2.0',
    method: 'evm_mine',
    id: new Date().getTime()
  })
}

describe('GTCR subgraph', function () {
  let centralizedArbitrator
  let gtcrFactory
  let gtcr

  let submitter
  before('get deployed contracts and accouts', async function () {
    centralizedArbitrator = await SimpleCentralizedArbitrator.deployed()
    gtcrFactory = await gtcrFactory.deployed()
    await gtcrFactory.deploy(
      centralizedArbitrator.address, // Arbitrator to resolve potential disputes. The arbitrator is trusted to support appeal periods and not reenter.
      '0x00', // Extra data for the trusted arbitrator contract.
      accounts[0], // Connected TCR is not used (any address here works). // The address of the TCR that stores related TCR addresses. This parameter can be left empty.
      '', // The URI of the meta evidence object for registration requests.
      '', // The URI of the meta evidence object for clearing requests.
      accounts[0], // The trusted governor of this contract.
      0, // The base deposit to submit an item.
      0, // The base deposit to remove an item.
      0, // The base deposit to challenge a submission.
      0, // The base deposit to challenge a removal request.
      5, // The time in seconds parties have to challenge a request.
      [0, 0, 0] // Multipliers of the arbitration cost in basis points (see MULTIPLIER_DIVISOR) as follows:
    )
    const gtcrAddr = await gtcrFactory.instances(0);
    gtcr = web3.eth.Contract(_GeneralizedTCR, await gtcrFactory.instances(0))


    const accounts = await web3.eth.getAccounts()
    submitter = accounts[0]
  })

  it('Exists', async function () {
    const { subgraphs } = await queryGraph(`{
      subgraphs(first: 1, where: {name: "${subgraphName}"}) {
        id
      }
    }`)

    subgraphs.should.be.not.empty()
  })

  step('Submit item', async function () {
    const columns = [
      {
        label: 'Name',
        type: ItemTypes.TEXT
      },
      {
        label: 'Ticker',
        type: ItemTypes.TEXT
      }
    ] // This information can be found in the TCR meta evidence.
    const tokenData = {
      Name: 'Pinakion',
      Ticker: 'PNK'
    }

    const [, REGISTERED, REGISTRATION_REQUESTED] = [0, 1, 2, 3, 4]

    const arbitrationCost = await centralizedArbitrator.arbitrationCost('0x00')
    const encodedData = gtcrEncode({ columns, values: tokenData })
    await gtcr.addItem(encodedData, { from: submitter, value: arbitrationCost })
    const itemID = await gtcr.itemList(0)

    await advanceBlock()
    await waitForGraphSync()
    expect((await querySubgraph(`{
      gtcr(id: "${itemID}") {
        data
        status
      }
    }`)).gtcr).to.deep.equal({ data: encodedData, status: REGISTRATION_REQUESTED })

    await increaseTime(10)
    await gtcr.executeRequest(itemID, { from: submitter })

    await advanceBlock()
    await waitForGraphSync()
    expect((await querySubgraph(`{
      gtcr(id: "${itemID}") {
        data
        status
      }
    }`)).gtcr).to.deep.equal({ data: encodedData, status: REGISTERED })
  })
})
