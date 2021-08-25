/* eslint-disable prefer-const */
import {
  Bytes,
  BigInt,
  Address,
  ipfs,
  json,
  JSONValue,
  JSONValueKind,
  log,
} from '@graphprotocol/graph-ts';
import {
  Item,
  ItemProp,
  Request,
  Round,
  Registry,
  MetaEvidence,
  Arbitrator,
} from '../generated/schema';
import {
  AppealPossible,
  IArbitrator,
} from '../generated/templates/IArbitrator/IArbitrator';
import { IArbitrator as IArbitratorDataSourceTemplate } from '../generated/templates';
import {
  Contribution,
  Dispute,
  LightGeneralizedTCR,
  ItemStatusChange,
  RequestSubmitted,
  MetaEvidence as MetaEvidenceEvent,
  NewItem,
  RewardWithdrawn,
} from '../generated/templates/LightGeneralizedTCR/LightGeneralizedTCR';

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
//
// A variable naming convention regarding arrays and entities:
// Index: This is the position of the in-contract array.
// ID: This is the entity id.
//
// Example:
// requestIndex: 0
// requestID: <itemID>@<tcrAddress>-0
//
// The only exception to this rule is the itemID, which is the in-contract itemID.

let ABSENT = 'Absent';
let REGISTERED = 'Registered';
let REGISTRATION_REQUESTED = 'RegistrationRequested';
let CLEARING_REQUESTED = 'ClearingRequested';

let NONE = 'None';
let ACCEPT = 'Accept';
let REJECT = 'Reject';

let REQUESTER_CODE = 1;

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

function buildNewRound(
  roundID: string,
  requestID: string,
  timestamp: BigInt,
): Round {
  let newRound = new Round(roundID);
  newRound.amountPaidRequester = BigInt.fromI32(0);
  newRound.amountPaidChallenger = BigInt.fromI32(0);
  newRound.feeRewards = BigInt.fromI32(0);
  newRound.hasPaidRequester = false;
  newRound.hasPaidChallenger = false;
  newRound.request = requestID;
  newRound.appealPeriodStart = BigInt.fromI32(0);
  newRound.appealPeriodEnd = BigInt.fromI32(0);
  newRound.rulingTime = BigInt.fromI32(0);
  newRound.ruling = NONE;
  newRound.creationTime = timestamp;
  return newRound;
}

let ZERO_ADDRESS = Bytes.fromHexString(
  '0x0000000000000000000000000000000000000000',
) as Bytes;

function JSONValueToMaybeString(
  value: JSONValue | null,
  _default: string | null = '',
): string | null {
  if (value == null || value.isNull()) {
    return null;
  }

  switch (value.kind) {
    case JSONValueKind.BOOL:
      return value.toBool() == true ? 'true' : 'false';
    case JSONValueKind.STRING:
      return value.toString();
    case JSONValueKind.NUMBER:
      return value.toBigInt().toHexString();
    default:
      return _default;
  }
}

function JSONValueToBool(
  value: JSONValue | null,
  _default: boolean = false,
): boolean {
  if (value == null || value.isNull()) {
    return _default;
  }

  switch (value.kind) {
    case JSONValueKind.BOOL:
      return value.toBool();
    case JSONValueKind.STRING:
      return value.toString() === 'true';
    case JSONValueKind.NUMBER:
      return value.toBigInt().notEqual(BigInt.fromString('0'));
    default:
      return _default;
  }
}

export function handleNewItem(event: NewItem): void {
  // We assume this is an item added via addItemDirectly.
  // If it was emitted via addItem, all the missing data
  // will be set in handleRequestSubmitted.
  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  let gtcrContract = LightGeneralizedTCR.bind(event.address);
  let registry = Registry.load(event.address.toHexString());
  let itemInfo = gtcrContract.getItemInfo(event.params._itemID);

  let item = new Item(graphItemID);
  item.itemID = event.params._itemID;
  item.data = event.params._data;
  item.numberOfRequests = BigInt.fromI32(0);
  item.registry = registry.id;
  item.disputed = false;
  item.status = getStatus(itemInfo.value0);
  item.latestRequester = ZERO_ADDRESS;
  item.latestChallenger = ZERO_ADDRESS;
  item.latestRequestResolutionTime = BigInt.fromI32(0);
  item.latestRequestSubmissionTime = BigInt.fromI32(0);

  registry.numberOfItems = registry.numberOfItems.plus(BigInt.fromI32(1));

  let keywordList: string[] = [];

  let jsonStr = ipfs.cat(item.data);
  if (jsonStr != null) {
    let jsonObj = json.fromBytes(jsonStr as Bytes).toObject();
    let columns = jsonObj.get('columns').toArray();
    let values = jsonObj.get('values').toObject();

    for (let i = 0; i < columns.length; i++) {
      let col = columns[i];
      let colObj = col.toObject();

      let label = colObj.get('label');

      let description = colObj.get('description');
      let _type = colObj.get('type');
      let isIdentifier = colObj.get('isIdentifier');

      let value = values.get(label.toString());

      let itemPropId = graphItemID + '@' + label.toString();
      let itemProp = new ItemProp(itemPropId);
      itemProp.type = JSONValueToMaybeString(_type);
      itemProp.label = JSONValueToMaybeString(label);
      itemProp.description = JSONValueToMaybeString(description);
      itemProp.isIdentifier = JSONValueToBool(isIdentifier);
      itemProp.value = JSONValueToMaybeString(value);
      itemProp.item = item.id;

      if (itemProp.isIdentifier && itemProp.value != null) {
        keywordList.push(itemProp.value);
      }

      itemProp.save();
    }
  } else {
    log.error('Failed to fetch item #{} JSON: {}', [graphItemID, item.data]);
  }

  if (keywordList.length > 0) {
    item.keywords = keywordList.join(' | ');
  }

  item.save();
  registry.save();
}

export function handleRequestSubmitted(event: RequestSubmitted): void {
  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();

  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemInfo = tcr.getItemInfo(event.params._itemID);
  let item = Item.load(graphItemID);
  let registry = Registry.load(event.address.toHexString());

  item.numberOfRequests = item.numberOfRequests.plus(BigInt.fromI32(1));
  item.status = getStatus(itemInfo.value0);
  item.latestRequester = event.transaction.from;
  item.latestRequestResolutionTime = BigInt.fromI32(0);
  item.latestRequestSubmissionTime = event.block.timestamp;

  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestID = graphItemID + '-' + requestIndex.toString();

  let request = new Request(requestID);
  request.disputed = false;
  request.arbitrator = tcr.arbitrator();
  request.arbitratorExtraData = tcr.arbitratorExtraData();
  request.challenger = ZERO_ADDRESS;
  request.requester = event.transaction.from;
  request.item = item.id;
  request.registry = registry.id;
  request.resolutionTime = BigInt.fromI32(0);
  request.disputeOutcome = NONE;
  request.resolved = false;
  request.disputeID = BigInt.fromI32(0);
  request.submissionTime = event.block.timestamp;
  request.numberOfRounds = BigInt.fromI32(1);
  request.requestType = item.status;
  request.evidenceGroupID = event.params._evidenceGroupID;
  request.creationTx = event.transaction.hash;
  if (request.requestType == REGISTRATION_REQUESTED)
    request.metaEvidence = registry.registrationMetaEvidence;
  else request.metaEvidence = registry.clearingMetaEvidence;

  let roundID = requestID + '-0';

  // Note that everything related to the deposit is handled
  // in handleContribution.
  let round = buildNewRound(roundID, requestID, event.block.timestamp);

  round.save();
  request.save();
  item.save();
}

export function handleContribution(event: Contribution): void {
  // This handler is triggered in 3 situations:
  // - When a user places a request
  // - When a user challenges a request
  // - When a user funds a side of an appeal.

  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  let item = Item.load(graphItemID);
  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestID = graphItemID + '-' + requestIndex.toString();
  let request = Request.load(requestID);

  let roundIndex = request.numberOfRounds.minus(BigInt.fromI32(1));
  let roundID = requestID + '-' + roundIndex.toString();
  let round = Round.load(roundID);

  let tcr = LightGeneralizedTCR.bind(event.address);
  let arbitrator = IArbitrator.bind(request.arbitrator as Address);

  let requestInfo = tcr.getRequestInfo(event.params._itemID, requestIndex);
  let arbitrationCost = arbitrator.arbitrationCost(request.arbitratorExtraData);
  if (!item.disputed) {
    // This is a requestStatusChange deposit.
    round.amountPaidRequester = event.params._contribution;
    round.hasPaidRequester = true;
    round.feeRewards = round.amountPaidRequester;
  } else if (requestInfo.value5.equals(BigInt.fromI32(2))) {
    // request.value5 is request.numberOfRounds.
    // If there are 2 rounds a dispute was created
    // (i.e. this is the challenge deposit).
    round.amountPaidChallenger = event.params._contribution;
    round.hasPaidChallenger = true;
    round.feeRewards = round.feeRewards
      .plus(round.amountPaidChallenger)
      .minus(arbitrationCost);
  } else {
    // Appeal fee contribution
    if (event.params._side == REQUESTER_CODE) {
      round.amountPaidRequester = round.amountPaidRequester.plus(
        event.params._contribution,
      );
    } else {
      round.amountPaidChallenger = round.amountPaidChallenger.plus(
        event.params._contribution,
      );
    }
    round.feeRewards = round.feeRewards.plus(event.params._contribution);

    let roundInfo = tcr.getRoundInfo(
      event.params._itemID,
      requestIndex,
      roundIndex,
    );
    // Note: roundInfo.value2 is round.hasPaid[3]
    round.hasPaidChallenger = roundInfo.value2[2];
    round.hasPaidRequester = roundInfo.value2[1];

    if (round.hasPaidRequester && round.hasPaidChallenger) {
      let appealCost = arbitrator.appealCost(
        request.disputeID,
        request.arbitratorExtraData,
      );
      round.feeRewards = round.feeRewards.minus(appealCost);

      let newRoundID =
        requestID +
        '-' +
        requestInfo.value5.minus(BigInt.fromI32(1)).toString();
      let newRound = buildNewRound(
        newRoundID,
        request.id,
        event.block.timestamp,
      );
      newRound.save();

      request.numberOfRounds = request.numberOfRounds.plus(BigInt.fromI32(1));
    }
  }

  request.save();
  round.save();
}

export function handleRequestChallenged(event: Dispute): void {
  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemID = tcr.arbitratorDisputeIDToItemID(
    event.params._arbitrator,
    event.params._disputeID,
  );
  let graphItemID = itemID.toHexString() + '@' + event.address.toHexString();
  let item = Item.load(graphItemID);
  item.disputed = true;
  item.latestChallenger = event.transaction.from;

  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestID = graphItemID + '-' + requestIndex.toString();
  let request = Request.load(requestID);
  request.disputed = true;
  request.challenger = event.transaction.from;
  request.numberOfRounds = BigInt.fromI32(2);
  request.disputeID = event.params._disputeID;

  let newRoundID = requestID + '-' + requestIndex.toString();
  let newRound = buildNewRound(newRoundID, request.id, event.block.timestamp);
  newRound.save();
  request.save();
  item.save();
}

export function handleAppealPossible(event: AppealPossible): void {
  let registry = Registry.load(event.params._arbitrable.toHexString());
  if (registry == null) return; // Event not related to a GTCR.

  let tcr = LightGeneralizedTCR.bind(event.params._arbitrable);
  let itemID = tcr.arbitratorDisputeIDToItemID(
    event.address,
    event.params._disputeID,
  );
  let graphItemID =
    itemID.toHexString() + '@' + event.params._arbitrable.toHexString();
  let item = Item.load(graphItemID);

  let request = Request.load(
    item.id + '-' + item.numberOfRequests.minus(BigInt.fromI32(1)).toString(),
  );

  let round = Round.load(
    request.id +
      '-' +
      request.numberOfRounds.minus(BigInt.fromI32(1)).toString(),
  );

  let arbitrator = IArbitrator.bind(event.address);
  let appealPeriod = arbitrator.appealPeriod(event.params._disputeID);
  round.appealPeriodStart = appealPeriod.value0;
  round.appealPeriodEnd = appealPeriod.value1;
  round.rulingTime = event.block.timestamp;

  let currentRuling = arbitrator.currentRuling(request.disputeID);
  round.ruling = currentRuling.equals(BigInt.fromI32(0))
    ? NONE
    : currentRuling.equals(BigInt.fromI32(1))
    ? ACCEPT
    : REJECT;

  item.save();
  round.save();
}

export function handleRequestResolved(event: ItemStatusChange): void {
  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemInfo = tcr.getItemInfo(event.params._itemID);
  if (itemInfo.value0 == 2 || itemInfo.value0 == 3) return; // Request is not resolved yet. No-op.

  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();

  let item = Item.load(graphItemID);
  item.status = getStatus(itemInfo.value0);
  item.latestRequestResolutionTime = event.block.timestamp;
  item.disputed = false;
  item.save();

  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestInfo = tcr.getRequestInfo(event.params._itemID, requestIndex);

  let request = Request.load(graphItemID + '-' + requestIndex.toString());
  request.resolved = true;
  request.resolutionTime = event.block.timestamp;
  request.resolutionTx = event.transaction.hash;
  request.disputeOutcome = getFinalRuling(requestInfo.value6);

  request.save();
}

export function handleRewardWithdrawn(event: RewardWithdrawn): void {
  // TODO
}

export function handleMetaEvidence(event: MetaEvidenceEvent): void {
  let registry = Registry.load(event.address.toHexString());

  registry.metaEvidenceCount = registry.metaEvidenceCount.plus(
    BigInt.fromI32(1),
  );

  if (registry.metaEvidenceCount.equals(BigInt.fromI32(1))) {
    // This means this is the first meta evidence event emitted,
    // in the constructor.
    // Use this opportunity to create the arbitrator datasource
    // to start monitoring it for events (if we aren't already).
    let tcr = LightGeneralizedTCR.bind(event.address);
    let arbitratorAddr = tcr.arbitrator();
    let arbitrator = Arbitrator.load(arbitratorAddr.toHexString());
    if (!arbitrator) {
      IArbitratorDataSourceTemplate.create(arbitratorAddr);
      arbitrator = new Arbitrator(arbitratorAddr.toHexString());
      arbitrator.save();
    }
  }

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
