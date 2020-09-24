import { Bytes, log, BigInt, Address } from '@graphprotocol/graph-ts'
import { Item, Request, Round } from '../generated/schema'
import { GeneralizedTCR, ItemStatusChange, ItemSubmitted } from '../generated/templates/GeneralizedTCR/GeneralizedTCR'
import { IArbitrator } from '../generated/templates/IArbitrator/IArbitrator'

// Items on a TCR can be in 1 of 4 states:
// - (0) Absent: The item is not registered on the TCR and there are no pending requests.
// - (1) Registered: The item is registered and there are no pending requests.
// - (2) Registration Requested: The item is not registered on the TCR, but there is a pending
//       registration request.
// - (3) Clearing Requested: The item is registered on the TCR, but there is a pending removal
//       request. These are sometimes also called removal requests.
//
// Registration and removal requests can be challenged. Once the request resolves (either by
// passing the challenge period or via dispute resolution), the item state is updated to 0 or 1.


const ABSENT = "Absent"
const REGISTERED = "Registered"
const REGISTRATION_REQUESTED = "RegistrationRequested"
const CLEARING_REQUESTED = "ClearingRequested"

const NONE = "None"
const ACCEPT = "Accept"
const REJECT = "Reject"

const REQUESTER = "Requester"
const CHALLENGER = "Challenger"

function getStatus(status: number): string {
  if (status == 0) return ABSENT
  if (status == 1) return REGISTERED
  if (status == 2) return REGISTRATION_REQUESTED
  if (status == 3) return CLEARING_REQUESTED
  return "Error"
}

function getWinner(outcome: number): string {
  if (outcome == 0) return NONE
  if (outcome == 1) return REQUESTER
  if (outcome == 2) return CHALLENGER
  return "Error"
}

let ZERO_ADDRESS = Bytes.fromHexString("0x0000000000000000000000000000000000000000") as Bytes

export function handleItemSubmitted(event: ItemSubmitted): void {
  log.info("GTCR: New item submitted: {}",[event.params._itemID.toHexString()])

  let tcr = GeneralizedTCR.bind(event.address)
  let itemInfo = tcr.getItemInfo(event.params._itemID)

  let item = new Item(event.params._itemID.toHexString())
  item.data = itemInfo.value0
  item.status = getStatus(itemInfo.value1)
  item.numberOfRequests = 1

  let requestID = event.params._itemID.toHexString() + '-0'
  let request = new Request(requestID)
  request.disputed = false
  request.arbitrator = tcr.arbitrator()
  request.arbitratorExtraData = tcr.arbitratorExtraData()
  request.challenger = ZERO_ADDRESS
  request.requester = event.params._submitter
  request.metaEvidenceID = BigInt.fromI32(2).times(tcr.metaEvidenceUpdates())
  request.winner = NONE
  request.resolved = false
  request.disputeID = 0
  request.submissionTime = event.block.timestamp
  request.evidenceGroupID = event.params._evidenceGroupID
  request.numberOfRounds = 1
  request.requestType = REGISTRATION_REQUESTED

  let roundID = requestID + '-0'
  let round = new Round(roundID)

  let arbitrator = IArbitrator.bind(request.arbitrator as Address)
  round.amountPaidRequester = tcr.submissionBaseDeposit().plus(arbitrator.arbitrationCost(request.arbitratorExtraData))
  round.amountpaidChallenger = BigInt.fromI32(0)
  round.feeRewards = BigInt.fromI32(0)
  round.hasPaidRequester = true
  round.hasPaidChallenger = false
  round.save()

  request.rounds =[round.id]
  request.save()

  item.requests = [request.id]
  item.save()
}

export function handleRequestResolved(event: ItemStatusChange): void {
  if (event.params._resolved == false) return // No-op.

  let itemID = event.params._itemID.toHexString()
  let tcrAddress = event.address.toHexString()
  log.info("GTCR: Request resolved. Item ID {} of TCR at {}",[itemID, tcrAddress])

  let tcr = GeneralizedTCR.bind(event.address)
  let itemInfo = tcr.getItemInfo(event.params._itemID)

  let item = Item.load(itemID)
  if (item == null) {
    log.error('GTCR: Item {} not found. Bailing.', [itemID])
    return
  }

  item.status = getStatus(itemInfo.value1)
  item.save()

  let requestInfo = tcr.getRequestInfo(event.params._itemID, event.params._requestIndex)

  let request = Request.load(itemID + '-' + event.params._requestIndex.toString())
  if (request == null) {
    log.error(
      'GTCR: Request {} of item {} of TCR {} not found. Bailing.',
      [
        event.params._requestIndex.toString(),
        itemID,
        tcrAddress
      ]
    )
    return
  }
  request.resolved = true
  request.winner = getWinner(requestInfo.value6)

  request.save()
}