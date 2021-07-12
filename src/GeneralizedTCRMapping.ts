import { Bytes, log, BigInt, Address } from '@graphprotocol/graph-ts';
import {
  Item,
  Request,
  Round,
  Registry,
  MetaEvidence,
} from '../generated/schema';
import { IArbitrator } from '../generated/templates/IArbitrator/IArbitrator';
import {
  AppealContribution,
  Dispute,
  GeneralizedTCR,
  HasPaidAppealFee,
  ItemStatusChange,
  RequestEvidenceGroupID,
  MetaEvidence as MetaEvidenceEvent,
} from '../generated/templates/GeneralizedTCR/GeneralizedTCR';

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

const ABSENT = 'Absent';
const REGISTERED = 'Registered';
const REGISTRATION_REQUESTED = 'RegistrationRequested';
const CLEARING_REQUESTED = 'ClearingRequested';

const NONE = 'None';
const ACCEPT = 'Accept';
const REJECT = 'Reject';

const REQUESTER_CODE = 1;

function getStatus(status: number): string {
  if (status == 0) return ABSENT;
  if (status == 1) return REGISTERED;
  if (status == 2) return REGISTRATION_REQUESTED;
  if (status == 3) return CLEARING_REQUESTED;
  return 'Error';
}

function getFinalRuling(outcome: number): string {
  if (outcome == 0) return NONE;
  if (outcome == 1) return ACCEPT;
  if (outcome == 2) return REJECT;
  return 'Error';
}

function buildNewRound(roundID: string, requestId: string): Round {
  const newRound = new Round(roundID);
  newRound.amountPaidRequester = BigInt.fromI32(0);
  newRound.amountPaidChallenger = BigInt.fromI32(0);
  newRound.feeRewards = BigInt.fromI32(0);
  newRound.hasPaidRequester = false;
  newRound.hasPaidChallenger = false;
  newRound.request = requestId;
  return newRound;
}

const ZERO_ADDRESS = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000',
) as Bytes;

export function handleRequestSubmitted(event: RequestEvidenceGroupID): void {
  const tcr = GeneralizedTCR.bind(event.address);
  const graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();

  const itemInfo = tcr.getItemInfo(event.params._itemID);
  let item = Item.load(graphItemID);
  const registry = Registry.load(event.address.toHexString());
  if (item == null) {
    item = new Item(graphItemID);
    item.itemID = event.params._itemID;
    item.data = itemInfo.value0;
    item.numberOfRequests = 1;
    item.registry = registry.id;
  } else {
    item.numberOfRequests++;
  }
  item.status = getStatus(itemInfo.value1);

  const requestID =
    graphItemID + '-' + itemInfo.value2.minus(BigInt.fromI32(1)).toString();

  const request = new Request(requestID);
  request.disputed = false;
  request.arbitrator = tcr.arbitrator();
  request.arbitratorExtraData = tcr.arbitratorExtraData();
  request.challenger = ZERO_ADDRESS;
  request.requester = event.transaction.from;
  request.item = item.id;

  request.disputeOutcome = NONE;
  request.resolved = false;
  request.disputeID = 0;
  request.submissionTime = event.block.timestamp;
  request.numberOfRounds = 1;
  request.requestType = item.status;
  request.evidenceGroupID = event.params._evidenceGroupID;

  const roundID = requestID + '-0';
  const round = new Round(roundID);

  const arbitrator = IArbitrator.bind(request.arbitrator as Address);
  if (request.requestType == REGISTRATION_REQUESTED) {
    round.amountPaidRequester = tcr
      .submissionBaseDeposit()
      .plus(arbitrator.arbitrationCost(request.arbitratorExtraData));
    request.metaEvidence = registry.registrationMetaEvidence;
  } else {
    round.amountPaidRequester = tcr
      .removalBaseDeposit()
      .plus(arbitrator.arbitrationCost(request.arbitratorExtraData));
    request.metaEvidence = registry.clearingMetaEvidence;
  }

  round.feeRewards = round.amountPaidRequester;
  round.amountPaidChallenger = BigInt.fromI32(0);
  round.hasPaidRequester = true;
  round.hasPaidChallenger = false;
  round.request = request.id;
  round.save();
  request.save();
  item.save();
}

export function handleRequestResolved(event: ItemStatusChange): void {
  if (event.params._resolved == false) return; // No-op.

  const graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  const tcrAddress = event.address.toHexString();

  const tcr = GeneralizedTCR.bind(event.address);
  const itemInfo = tcr.getItemInfo(event.params._itemID);

  const item = Item.load(graphItemID);
  if (item == null) {
    log.error('GTCR: Item {} @ {} not found. Bailing handleRequestResolved.', [
      event.params._itemID.toHexString(),
      tcrAddress,
    ]);
    return;
  }

  item.status = getStatus(itemInfo.value1);
  item.save();

  const requestInfo = tcr.getRequestInfo(
    event.params._itemID,
    event.params._requestIndex,
  );

  const request = Request.load(
    graphItemID + '-' + event.params._requestIndex.toString(),
  );
  if (request == null) {
    log.error('GTCR: Request {} of item {} of TCR {} not found. Bailing.', [
      event.params._requestIndex.toString(),
      event.params._itemID.toHexString(),
      tcrAddress,
    ]);
    return;
  }
  request.resolved = true;
  request.disputeOutcome = getFinalRuling(requestInfo.value6);

  request.save();
}

export function handleRequestChallenged(event: Dispute): void {
  const tcr = GeneralizedTCR.bind(event.address);
  const itemID = tcr.arbitratorDisputeIDToItem(
    event.params._arbitrator,
    event.params._disputeID,
  );
  const graphItemID = itemID.toHexString() + '@' + event.address.toHexString();
  const item = Item.load(graphItemID);
  if (item == null) {
    log.error('GTCR: Item {} not found. Bailing handleRequestResolved.', [
      graphItemID,
    ]);
    return;
  }

  const itemInfo = tcr.getItemInfo(itemID);
  const requestID =
    graphItemID + '-' + itemInfo.value2.minus(BigInt.fromI32(1)).toString();
  const request = Request.load(requestID);
  request.disputed = true;
  request.numberOfRounds = 2;

  const requestInfo = tcr.getRequestInfo(
    itemID,
    itemInfo.value2.minus(BigInt.fromI32(1)),
  );
  const roundID =
    requestID + '-' + requestInfo.value5.minus(BigInt.fromI32(2)).toString();
  const round = Round.load(roundID);
  const arbitrator = IArbitrator.bind(request.arbitrator as Address);
  const arbitrationCost = arbitrator.arbitrationCost(request.arbitratorExtraData);
  if (request.requestType == REGISTRATION_REQUESTED)
    round.amountPaidChallenger = tcr
      .submissionChallengeBaseDeposit()
      .plus(arbitrationCost);
  else
    round.amountPaidChallenger = tcr
      .removalChallengeBaseDeposit()
      .plus(arbitrationCost);

  round.feeRewards = round.feeRewards
    .plus(round.amountPaidChallenger)
    .minus(arbitrationCost);
  round.hasPaidChallenger = true;
  round.save();

  const newRoundID =
    requestID + '-' + requestInfo.value5.minus(BigInt.fromI32(1)).toString();
  const newRound = buildNewRound(newRoundID, request.id);
  newRound.save();
  request.save();
}

export function handleAppealContribution(event: AppealContribution): void {
  const graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  const item = Item.load(graphItemID);
  if (item == null) {
    log.error('GTCR: Item {} @ {} not found. Bailing handleRequestResolved.', [
      event.params._itemID.toHexString(),
      event.address.toHexString(),
    ]);
    return;
  }

  const requestID = graphItemID + '-' + event.params._request.toString();

  const roundID = requestID + '-' + event.params._round.toString();
  const round = Round.load(roundID);
  if (event.params._side == REQUESTER_CODE) {
    round.amountPaidRequester = round.amountPaidRequester.plus(
      event.params._amount,
    );
    let feeRewards = round.feeRewards;
    feeRewards = feeRewards.plus(round.amountPaidRequester);
    round.feeRewards = feeRewards;
  } else {
    round.amountPaidChallenger = round.amountPaidChallenger.plus(
      event.params._amount,
    );
    let feeRewards = round.feeRewards;
    feeRewards = feeRewards.plus(round.amountPaidChallenger);
    round.feeRewards = feeRewards;
  }

  round.save();
}

export function handleHasPaidAppealFee(event: HasPaidAppealFee): void {
  const tcr = GeneralizedTCR.bind(event.address);
  const graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  const item = Item.load(graphItemID);
  if (item == null) {
    log.error('GTCR: Item {} @ {} not found. Bailing handleRequestResolved.', [
      event.params._itemID.toHexString(),
      event.address.toHexString(),
    ]);
    return;
  }

  const requestID = graphItemID + '-' + event.params._request.toString();

  const requestInfo = tcr.getRequestInfo(
    event.params._itemID,
    event.params._request,
  );
  const roundID = requestID + '-' + event.params._round.toString();
  const round = Round.load(roundID);
  if (event.params._side == REQUESTER_CODE) {
    round.hasPaidRequester = true;
  } else {
    round.hasPaidChallenger = true;
  }

  if (round.hasPaidRequester && round.hasPaidChallenger) {
    const request = Request.load(
      graphItemID + '-' + event.params._request.toString(),
    );
    const arbitrator = IArbitrator.bind(request.arbitrator as Address);
    const appealCost = arbitrator.appealCost(
      BigInt.fromI32(request.disputeID),
      request.arbitratorExtraData,
    );
    round.feeRewards = round.feeRewards.minus(appealCost);
    const newRoundID =
      requestID + '-' + requestInfo.value5.minus(BigInt.fromI32(1)).toString();
    const newRound = buildNewRound(newRoundID, request.id);
    newRound.save();

    request.numberOfRounds = request.numberOfRounds + 1;
    request.save();
  }

  round.save();
}

export function handleMetaEvidence(event: MetaEvidenceEvent): void {
  const registry = Registry.load(event.address.toHexString());

  registry.metaEvidenceCount = registry.metaEvidenceCount.plus(
    BigInt.fromI32(1),
  );

  let metaEvidence = MetaEvidence.load(
    registry.id + '-' + registry.metaEvidenceCount.toString(),
  );
  if (metaEvidence == null) {
    metaEvidence = new MetaEvidence(
      registry.id + '-' + registry.metaEvidenceCount.toString(),
    );
  }

  metaEvidence.URI = event.params._evidence;
  metaEvidence.save();

  if (
    registry.metaEvidenceCount.mod(BigInt.fromI32(2)).equals(BigInt.fromI32(1))
  ) {
    registry.registrationMetaEvidence = metaEvidence.id;
  } else {
    registry.clearingMetaEvidence = metaEvidence.id;
  }

  registry.save();
}
