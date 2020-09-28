
/* global describe, before, step */
const Web3 = require('web3')
const TruffleContract = require('@truffle/contract')
const { default: axios } = require('axios')
const delay = require('delay')
const fs = require('fs-extra')
const path = require('path')
const { ethers } = require('ethers')
const { gtcrEncode, ItemTypes } = require('@kleros/gtcr-encoder')
const { expect } = require('chai')
const { promisify } = require('util')
const _GeneralizedTCR = require('../build/contracts/GeneralizedTCR.json')
require('should')

const web3Provider = new Web3.providers.HttpProvider('http://localhost:8545')
const ethersProvider = new ethers.providers.JsonRpcProvider()
const web3 = new Web3(web3Provider)
const signer = ethersProvider.getSigner()
const { BigNumber } = ethers

function getContract (contractName) {
  const C = TruffleContract(fs.readJsonSync(path.join(
    __dirname, '..', 'build', 'contracts', `${contractName}.json`
  )))
  C.setProvider(web3Provider)
  return C
}

const TestArbitrator = getContract('TestArbitrator')
const GTCRFactory = getContract('GTCRFactory')

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
      latestEthereumBlockNumber.toString() === targetBlockNumber.toString()
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

function buildFullItemQuery (itemID) {
  return `{
    item(id: "${itemID}") {
      id
      data
      status
      numberOfRequests
      requests {
        id
        disputed
        arbitrator
        arbitratorExtraData
        challenger
        requester
        metaEvidenceID
        winner
        resolved
        disputeID
        submissionTime
        evidenceGroupID
        numberOfRounds
        requestType
        rounds {
          id
          amountPaidRequester
          amountPaidChallenger
          feeRewards
          hasPaidRequester
          hasPaidChallenger
        }
      }
    }
  }`
}

const Status = {
  Absent: 'Absent',
  RegistrationRequested: 'RegistrationRequested',
  Registered: 'Registered',
  ClearingRequested: 'ClearingRequested'
}

const Ruling = {
  None: 'None',
  Accept: 'Accept',
  Reject: 'Reject',
}

const RulingCodes = {
  None: 0,
  Accept: 1,
  Reject: 2,
}

const PartyCodes = {
  None: 0,
  Requester: 1,
  Challenger: 2,
}

const submissionBaseDeposit = BigNumber.from(0)
const submissionChallengeBaseDeposit = BigNumber.from(0)
const removalBaseDeposit = BigNumber.from(0)
const removalChallengeBaseDeposit = BigNumber.from(0)
const arbitratorExtraData = "0x00"
const challengePeriodDuration = 10

describe('GTCR subgraph', function () {
  let centralizedArbitrator
  let gtcrFactory
  let gtcr

  let accounts
  let submitter
  before('get deployed contracts and accounts', async function () {
    [
      centralizedArbitrator,
      gtcrFactory,
      accounts
    ] = await Promise.all([
      TestArbitrator.deployed(),
      await GTCRFactory.deployed(),
      await web3.eth.getAccounts()
    ])
    submitter = accounts[0]

    await gtcrFactory.deploy(
      centralizedArbitrator.address, // Arbitrator to resolve potential disputes. The arbitrator is trusted to support appeal periods and not reenter.
      arbitratorExtraData,// Extra data for the trusted arbitrator contract.
      accounts[0], // Connected TCR is not used (any address here works for this test). // The address of the TCR that stores related TCR addresses. This parameter can be left empty.
      '', // The URI of the meta evidence object for registration requests.
      '', // The URI of the meta evidence object for clearing requests.
      accounts[0], // The trusted governor of this contract.
      submissionBaseDeposit, // The base deposit to submit an item.
      removalBaseDeposit, // The base deposit to remove an item.
      submissionChallengeBaseDeposit, // The base deposit to challenge a submission.
      removalChallengeBaseDeposit, // The base deposit to challenge a removal request.
      challengePeriodDuration, // The time in seconds parties have to challenge a request.
      [10000, 10000, 10000], // Multipliers of the arbitration cost in basis points.
      { from: submitter }
    )
    const gtcrAddress = await gtcrFactory.instances(0)

    gtcr = new ethers.Contract(gtcrAddress, _GeneralizedTCR.abi, signer)
    baseRound = {
      amountPaidRequester: "0",
      amountPaidChallenger: "0",
      feeRewards: "0",
      hasPaidChallenger: false,
      hasPaidRequester: true,
    }

    baseRequest = {
      disputed: false,
      arbitrator: centralizedArbitrator.address.toLowerCase(),
      arbitratorExtraData: arbitratorExtraData,
      challenger: '0x0000000000000000000000000000000000000000',
      requester: submitter.toLowerCase(),
      metaEvidenceID: "0",
      winner: Ruling.None,
      resolved: false,
      disputeID: 0,
      numberOfRounds: 1,
      requestType: Status.RegistrationRequested,
    }
  })

  step('subgraph exists', async function () {
    const { subgraphs } = await queryGraph(`{
      subgraphs(first: 1, where: {name: "${subgraphName}"}) {
        id
      }
    }`)

    subgraphs.should.be.not.empty()
  })


  let itemID
  let graphItemID
  let arbitrationCost
  let itemState
  let encodedData
  let submissionDeposit
  let removalDeposit
  let removalChallengeDeposit

  let baseRound
  let baseRequest

  step('add item', async function () {
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
    encodedData = gtcrEncode({ columns, values: tokenData })

    arbitrationCost = BigNumber.from((await centralizedArbitrator.arbitrationCost(arbitratorExtraData)).toString())
    submissionDeposit = arbitrationCost.add(submissionBaseDeposit)

    await gtcr.addItem(encodedData, { from: submitter, value: submissionDeposit.toString() })
    itemID = await gtcr.itemList(0)
    graphItemID = itemID + '@' + gtcr.address.toLowerCase()
    const log = (await ethersProvider.getLogs({
      ...gtcr.filters.ItemSubmitted(itemID),
      fromBlock: 0
    })).map(log => gtcr.interface.parseLog(log))[0]
    const [,,evidenceGroupID] = log.args
    const { timestamp } = await ethersProvider.getBlock(log.blockNumber)


    await advanceBlock()
    await waitForGraphSync()
    itemState = {
      id: graphItemID,
      data: encodedData,
      status: Status.RegistrationRequested,
      numberOfRequests: 1,
      requests: [
        {
          ...baseRequest,
          id: `${graphItemID}-0`,
          submissionTime: timestamp.toString(),
          evidenceGroupID: evidenceGroupID.toString(),
          rounds: [
            {
              ...baseRound,
              id: `${graphItemID}-0-0`,
              amountPaidRequester: submissionDeposit.toString(),
              feeRewards: submissionDeposit.toString(),
            }
          ]
        }
      ]
    }
    expect((await querySubgraph(buildFullItemQuery(graphItemID))).item).to.deep.equal(itemState)

    increaseTime(challengePeriodDuration + 1)
    await gtcr.executeRequest(itemID)
    await waitForGraphSync()
    itemState.status = Status.Registered
    itemState.requests[0].resolved = true
    expect((await querySubgraph(buildFullItemQuery(graphItemID))).item).to.deep.equal(itemState)
  })

  step('challenge removal request', async function () {
    removalDeposit = arbitrationCost.add(removalBaseDeposit)
    await gtcr.removeItem(itemID, '/ipfs/Qw...', { from: submitter, value: removalDeposit.toString() })
    const log = (await ethersProvider.getLogs({
      ...gtcr.filters.RequestEvidenceGroupID(itemID, 1),
      fromBlock: 0
    })).map(log => gtcr.interface.parseLog(log))[0]

    const evidenceGroupID = log.args[2]
    const { timestamp } = await ethersProvider.getBlock(log.blockNumber)

    itemState.numberOfRequests++
    itemState.status = Status.ClearingRequested
    itemState.requests.push({
      ...baseRequest,
      id: `${graphItemID}-1`,
      requestType: Status.ClearingRequested,
      submissionTime: timestamp.toString(),
      evidenceGroupID: evidenceGroupID.toString(),
      rounds: [{
        ...baseRound,
        amountPaidRequester: removalDeposit.toString(),
        id: `${graphItemID}-1-0`,
        feeRewards: removalDeposit.toString()
      }]
    })

    increaseTime(challengePeriodDuration/2)
    removalChallengeDeposit = arbitrationCost.add(removalChallengeBaseDeposit)
    await gtcr.challengeRequest(itemID, '/ipfs/Qw...', { from: submitter, value: removalChallengeDeposit.toString() })

    itemState.requests[1].disputed = true
    itemState.requests[1].rounds[0].hasPaidChallenger = true
    itemState.requests[1].rounds[0].amountPaidChallenger = removalChallengeDeposit.toString()
    itemState.requests[1].rounds[0].feeRewards =
      BigNumber
        .from(itemState.requests[1].rounds[0].feeRewards)
        .add(removalChallengeDeposit)
        .sub(arbitrationCost)
        .toString()

    itemState.requests[1].rounds.push({
      ...baseRound,
      hasPaidRequester: false,
      id: `${graphItemID}-1-1`
    })

    await waitForGraphSync()
    expect((await querySubgraph(buildFullItemQuery(graphItemID))).item).to.deep.equal(itemState)
  })

  step('funding and raising appeal', async function () {
    await centralizedArbitrator.giveRuling(0, RulingCodes.Accept, { from: submitter })

    const [
      bnAppealCost,
      winnerStakeMultiplier,
      loserStakeMultiplier,
      multiplierDivisor,
    ] = await Promise.all([
      centralizedArbitrator.appealCost(0, arbitratorExtraData),
      gtcr.winnerStakeMultiplier(),
      gtcr.loserStakeMultiplier(),
      gtcr.MULTIPLIER_DIVISOR(),
    ])

    const appealCost = BigNumber.from(bnAppealCost.toString())
    const totalWinnerAppealDeposit =
      appealCost.add(
        appealCost.mul(winnerStakeMultiplier).div(multiplierDivisor)
      )

    const totalLoserAppealDeposit =
      appealCost.add(
        appealCost.mul(loserStakeMultiplier).div(multiplierDivisor)
      )

    await gtcr.fundAppeal(
      itemID,
      PartyCodes.Requester,
      { from: submitter, value: totalWinnerAppealDeposit }
    )

    await gtcr.fundAppeal(
      itemID,
      PartyCodes.Challenger,
      { from: submitter, value: totalLoserAppealDeposit }
    )

    await centralizedArbitrator.giveRuling(0, RulingCodes.Accept, { from: submitter })
    increaseTime(4 * 60) // Appeal period is 3 minutes long.

    await centralizedArbitrator.executeRuling(0, { from: submitter })
  })
})
