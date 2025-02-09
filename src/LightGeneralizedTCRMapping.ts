/* eslint-disable prefer-const */
import {
  BigInt,
  Address,
  log,
  DataSourceContext,
} from '@graphprotocol/graph-ts';
import {
  LItem,
  LRequest,
  LRound,
  LRegistry,
  MetaEvidence,
  LContribution,
  EvidenceGroup,
  Evidence,
  LArbitrator,
} from '../generated/schema';
import {
  AppealPossible,
  AppealDecision,
  IArbitrator,
} from '../generated/templates/LIArbitrator/IArbitrator';
import {
  LIArbitrator as IArbitratorDataSourceTemplate,
  LGTCREvidence as EvidenceMetadataTemplate,
  LItemMetadata as LItemMetadataTemplate,
  LRegistryMetadata as LRegistryMetadataTemplate,
} from '../generated/templates';
import {
  Contribution,
  Dispute,
  LightGeneralizedTCR,
  ItemStatusChange,
  RequestSubmitted,
  MetaEvidence as MetaEvidenceEvent,
  Evidence as EvidenceEvent,
  NewItem,
  RewardWithdrawn,
  Ruling,
  ConnectedTCRSet as ConnectedTCRSetEvent,
} from '../generated/templates/LightGeneralizedTCR/LightGeneralizedTCR';
import { ZERO_ADDRESS, extractPath } from './utils';

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
// Note that in this mapping, we also use extended status, which just map the combination
// of the item status and disputed status.
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
//
// TIP: Before reading an event handler for the very first time, we recommend
// looking at where that event is emitted in the contract. Remember that
// the order in which events are emitted define the order in which
// handlers are run.

let ABSENT = 'Absent';
let REGISTERED = 'Registered';
let REGISTRATION_REQUESTED = 'RegistrationRequested';
let CLEARING_REQUESTED = 'ClearingRequested';

let NONE = 'None';
let ACCEPT = 'Accept';
let REJECT = 'Reject';

let NO_RULING_CODE = 0;
let REQUESTER_CODE = 1;
let CHALLENGER_CODE = 2;

let ABSENT_CODE = 0;
let REGISTERED_CODE = 1;
let REGISTRATION_REQUESTED_CODE = 2;
let CLEARING_REQUESTED_CODE = 3;
let CHALLENGED_REGISTRATION_REQUEST_CODE = 4;
let CHALLENGED_CLEARING_REQUEST_CODE = 5;
let CONTRACT_STATUS_EXTENDED = new Map<string, number>();
CONTRACT_STATUS_EXTENDED.set(ABSENT, ABSENT_CODE);
CONTRACT_STATUS_EXTENDED.set(REGISTERED, REGISTERED_CODE);
CONTRACT_STATUS_EXTENDED.set(
  REGISTRATION_REQUESTED,
  REGISTRATION_REQUESTED_CODE,
);
CONTRACT_STATUS_EXTENDED.set(CLEARING_REQUESTED, CLEARING_REQUESTED_CODE);

let CONTRACT_STATUS_NAMES = new Map<number, string>();
CONTRACT_STATUS_NAMES.set(ABSENT_CODE, 'Absent');
CONTRACT_STATUS_NAMES.set(REGISTERED_CODE, 'Registered');
CONTRACT_STATUS_NAMES.set(REGISTRATION_REQUESTED_CODE, 'RegistrationRequested');
CONTRACT_STATUS_NAMES.set(CLEARING_REQUESTED_CODE, 'ClearingRequested');

function getExtendedStatus(disputed: boolean, status: string): number {
  if (disputed) {
    if (status == CONTRACT_STATUS_NAMES.get(REGISTRATION_REQUESTED_CODE))
      return CHALLENGED_REGISTRATION_REQUEST_CODE;
    else return CHALLENGED_CLEARING_REQUEST_CODE;
  }

  return CONTRACT_STATUS_EXTENDED.get(status) || 0;
}

function getStatus(status: number): string {
  if (status == ABSENT_CODE) return ABSENT;
  if (status == REGISTERED_CODE) return REGISTERED;
  if (status == REGISTRATION_REQUESTED_CODE) return REGISTRATION_REQUESTED;
  if (status == CLEARING_REQUESTED_CODE) return CLEARING_REQUESTED;
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
): LRound {
  let newRound = new LRound(roundID);
  newRound.amountPaidRequester = BigInt.fromI32(0);
  newRound.amountPaidChallenger = BigInt.fromI32(0);
  newRound.feeRewards = BigInt.fromI32(0);
  newRound.hasPaidRequester = false;
  newRound.hasPaidChallenger = false;
  newRound.lastFundedRequester = BigInt.fromI32(0);
  newRound.lastFundedChallenger = BigInt.fromI32(0);
  newRound.request = requestID;
  newRound.appealPeriodStart = BigInt.fromI32(0);
  newRound.appealPeriodEnd = BigInt.fromI32(0);
  newRound.rulingTime = BigInt.fromI32(0);
  newRound.ruling = NONE;
  newRound.creationTime = timestamp;
  newRound.numberOfContributions = BigInt.fromI32(0);
  newRound.appealed = false;
  return newRound;
}

/**
 * Decrements and increments registry counters based on item status change.
 *
 * The user should ensure that this function is called once and only once for
 * each status update. What handlers were called before and which will be called
 * after the one this is being called on? Do they call updateCounters?
 * @param previousStatus The previous extended status of the item.
 * @param newStatus The new extended status of the item.
 * @param registry The registry to which update the counters.
 */
function updateCounters(
  previousStatus: number,
  newStatus: number,
  registryAddress: Address,
): void {
  let registry = LRegistry.load(registryAddress.toHexString());
  if (!registry) {
    log.error(`LRegistry at {} not found.`, [registryAddress.toHexString()]);
    return;
  }

  if (previousStatus == ABSENT_CODE) {
    registry.numberOfAbsent = registry.numberOfAbsent.minus(BigInt.fromI32(1));
  } else if (previousStatus == REGISTERED_CODE) {
    registry.numberOfRegistered = registry.numberOfRegistered.minus(
      BigInt.fromI32(1),
    );
  } else if (previousStatus == REGISTRATION_REQUESTED_CODE) {
    registry.numberOfRegistrationRequested =
      registry.numberOfRegistrationRequested.minus(BigInt.fromI32(1));
  } else if (previousStatus == CLEARING_REQUESTED_CODE) {
    registry.numberOfClearingRequested =
      registry.numberOfClearingRequested.minus(BigInt.fromI32(1));
  } else if (previousStatus == CHALLENGED_REGISTRATION_REQUEST_CODE) {
    registry.numberOfChallengedRegistrations =
      registry.numberOfChallengedRegistrations.minus(BigInt.fromI32(1));
  } else if (previousStatus == CHALLENGED_CLEARING_REQUEST_CODE) {
    registry.numberOfChallengedClearing =
      registry.numberOfChallengedClearing.minus(BigInt.fromI32(1));
  }

  if (newStatus == ABSENT_CODE) {
    registry.numberOfAbsent = registry.numberOfAbsent.plus(BigInt.fromI32(1));
  } else if (newStatus == REGISTERED_CODE) {
    registry.numberOfRegistered = registry.numberOfRegistered.plus(
      BigInt.fromI32(1),
    );
  } else if (newStatus == REGISTRATION_REQUESTED_CODE) {
    registry.numberOfRegistrationRequested =
      registry.numberOfRegistrationRequested.plus(BigInt.fromI32(1));
  } else if (newStatus == CLEARING_REQUESTED_CODE) {
    registry.numberOfClearingRequested =
      registry.numberOfClearingRequested.plus(BigInt.fromI32(1));
  } else if (newStatus == CHALLENGED_REGISTRATION_REQUEST_CODE) {
    registry.numberOfChallengedRegistrations =
      registry.numberOfChallengedRegistrations.plus(BigInt.fromI32(1));
  } else if (newStatus == CHALLENGED_CLEARING_REQUEST_CODE) {
    registry.numberOfChallengedClearing =
      registry.numberOfChallengedClearing.plus(BigInt.fromI32(1));
  }

  registry.save();
}

export function handleNewItem(event: NewItem): void {
  // We assume this is an item added via addItemDirectly and care
  // only about saving the item json data.
  // If it was emitted via addItem, all the missing/wrong data regarding
  // things like submission time, arbitrator and deposit will be set in
  // handleRequestSubmitted.
  //
  // Accounting for items added or removed directly is done
  // inside handleStatusUpdated.
  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  let gtcrContract = LightGeneralizedTCR.bind(event.address);
  let registry = LRegistry.load(event.address.toHexString());
  if (!registry) {
    log.error(`LRegistry {} not found`, [event.address.toHexString()]);
    return;
  }

  let itemInfo = gtcrContract.getItemInfo(event.params._itemID);

  let item = new LItem(graphItemID);
  item.itemID = event.params._itemID;
  item.data = event.params._data;
  item.numberOfRequests = BigInt.fromI32(0);
  item.registry = registry.id;
  item.registryAddress = event.address;
  item.disputed = false;
  item.status = getStatus(itemInfo.value0);
  item.latestRequester = ZERO_ADDRESS;
  item.latestChallenger = ZERO_ADDRESS;
  item.latestRequestResolutionTime = BigInt.fromI32(0);
  item.latestRequestSubmissionTime = BigInt.fromI32(0);

  const ipfsHash = extractPath(event.params._data);
  item.metadata = `${ipfsHash}-${graphItemID}`;

  log.debug('Creating datasource for ipfs hash : {}', [ipfsHash]);

  const context = new DataSourceContext();
  context.setString('graphItemID', graphItemID);
  context.setString('address', event.address.toHexString());

  LItemMetadataTemplate.createWithContext(ipfsHash, context);

  item.save();
  registry.save();
}

export function handleRequestSubmitted(event: RequestSubmitted): void {
  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();

  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemInfo = tcr.getItemInfo(event.params._itemID);
  let item = LItem.load(graphItemID);
  if (!item) {
    log.error(`LItem for graphItemID {} not found.`, [graphItemID]);
    return;
  }

  let registry = LRegistry.load(event.address.toHexString());
  if (!registry) {
    log.error(`LRegistry at address {} not found`, [
      event.address.toHexString(),
    ]);
    return;
  }
  // `previousStatus` and `newStatus` are used for accounting.
  // Note that if this is the very first request of an item,
  // item.status and item.dispute are dirty because they were set by
  // handleNewItem, executed before this handler and so `previousStatus`
  // would be wrong. We use a condition to detect if its the very
  // first request and if so, ignore its contents (see below in accounting).
  let previousStatus = getExtendedStatus(item.disputed, item.status);

  item.numberOfRequests = item.numberOfRequests.plus(BigInt.fromI32(1));
  item.status = getStatus(itemInfo.value0);
  item.latestRequester = event.transaction.from;
  item.latestRequestResolutionTime = BigInt.fromI32(0);
  item.latestRequestSubmissionTime = event.block.timestamp;

  let newStatus = getExtendedStatus(item.disputed, item.status);

  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestInfo = tcr.getRequestInfo(event.params._itemID, requestIndex);
  let requestID = graphItemID + '-' + requestIndex.toString();

  let request = new LRequest(requestID);
  request.disputed = false;
  request.arbitrator = tcr.arbitrator();
  request.arbitratorExtraData = tcr.arbitratorExtraData();
  request.challenger = ZERO_ADDRESS;
  request.requester = requestInfo.value4[1];
  request.item = item.id;
  request.registry = registry.id;
  request.registryAddress = event.address;
  request.resolutionTime = BigInt.fromI32(0);
  request.disputeOutcome = NONE;
  request.resolved = false;
  request.disputeID = BigInt.fromI32(0);
  request.submissionTime = event.block.timestamp;
  request.numberOfRounds = BigInt.fromI32(1);
  request.requestType = item.status;

  // Handle the evidenceGroup situation. It might already exist
  let evidenceGroupId =
    event.params._evidenceGroupID.toString() +
    '@' +
    event.address.toHexString();
  let evidenceGroup = EvidenceGroup.load(evidenceGroupId);
  if (!evidenceGroup) {
    evidenceGroup = new EvidenceGroup(evidenceGroupId);
    evidenceGroup.numberOfEvidence = BigInt.fromI32(0);
    evidenceGroup.save();
  }

  request.evidenceGroup = evidenceGroupId;

  request.creationTx = event.transaction.hash;
  if (request.requestType == REGISTRATION_REQUESTED) {
    request.deposit = tcr.submissionBaseDeposit();
    request.metaEvidence = registry.registrationMetaEvidence;
  } else {
    request.deposit = tcr.removalBaseDeposit();
    request.metaEvidence = registry.clearingMetaEvidence;
  }
  let roundID = requestID + '-0';

  // Note that everything related to the deposit (e.g. contribution creation)
  // is handled in handleContribution.
  let round = buildNewRound(roundID, requestID, event.block.timestamp);

  // Accounting.
  if (itemInfo.value1.equals(BigInt.fromI32(1))) {
    // This is the first request for this item, which must be
    // a registration request.
    registry.numberOfRegistrationRequested =
      registry.numberOfRegistrationRequested.plus(BigInt.fromI32(1));
  } else {
    updateCounters(previousStatus, newStatus, event.address);
  }

  round.save();
  request.save();
  item.save();
  registry.save();
}

export function handleContribution(event: Contribution): void {
  // This handler is triggered in 3 situations:
  // - When a user places a request
  // - When a user challenges a request
  // - When a user funds a side of an appeal.

  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  let requestID = graphItemID + '-' + event.params._requestID.toString();
  let request = LRequest.load(requestID);
  if (!request) {
    log.error(`LRequest {} no found.`, [requestID]);
    return;
  }

  let roundID = requestID + '-' + event.params._roundID.toString();
  let round = LRound.load(roundID);
  if (!round) {
    log.error(`LRound {} not found.`, [roundID]);
    return;
  }

  let tcr = LightGeneralizedTCR.bind(event.address);
  if (event.params._roundID == BigInt.fromI32(0)) {
    if (event.params._side == 1) {
      round.amountPaidRequester = event.params._contribution;
      round.hasPaidRequester = true;
    } else {
      round.amountPaidChallenger = event.params._contribution;
      round.hasPaidChallenger = true;
    }
  } else {
    let roundInfo = tcr.getRoundInfo(
      event.params._itemID,
      event.params._requestID,
      event.params._roundID,
    );

    round.amountPaidRequester = roundInfo.value1[REQUESTER_CODE];
    round.amountPaidChallenger = roundInfo.value1[CHALLENGER_CODE];
    round.hasPaidRequester = roundInfo.value2[REQUESTER_CODE];
    round.hasPaidChallenger = roundInfo.value2[CHALLENGER_CODE];
    round.feeRewards = roundInfo.value3;
  }

  if (event.params._side === 1) {
    round.lastFundedRequester = event.block.timestamp;
  } else {
    round.lastFundedChallenger = event.block.timestamp;
  }

  let contributionID = roundID + '-' + round.numberOfContributions.toString();
  let contribution = new LContribution(contributionID);
  contribution.round = round.id;
  contribution.side = BigInt.fromI32(event.params._side);
  contribution.withdrawable = false;
  contribution.contributor = event.params._contributor;

  round.numberOfContributions = round.numberOfContributions.plus(
    BigInt.fromI32(1),
  );

  contribution.save();
  round.save();
}

export function handleRequestChallenged(event: Dispute): void {
  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemID = tcr.arbitratorDisputeIDToItemID(
    event.params._arbitrator,
    event.params._disputeID,
  );
  let graphItemID = itemID.toHexString() + '@' + event.address.toHexString();
  let item = LItem.load(graphItemID);
  if (!item) {
    log.warning(`LItem {} not found.`, [graphItemID]);
    return;
  }

  let previousStatus = getExtendedStatus(item.disputed, item.status);
  item.disputed = true;
  item.latestChallenger = event.transaction.from;
  let newStatus = getExtendedStatus(item.disputed, item.status);

  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestInfo = tcr.getRequestInfo(itemID, requestIndex);
  let requestID = graphItemID + '-' + requestIndex.toString();
  let request = LRequest.load(requestID);
  if (!request) {
    log.error(`LRequest {} not found.`, [requestID]);
    return;
  }

  request.disputed = true;
  request.challenger = requestInfo.value4[2];
  request.numberOfRounds = BigInt.fromI32(2);
  request.disputeID = event.params._disputeID;

  let newRoundID = requestID + '-1'; // When a dispute is created, the new round is always id 1
  let newRound = buildNewRound(newRoundID, request.id, event.block.timestamp);

  // Accounting.
  updateCounters(previousStatus, newStatus, event.address);

  newRound.save();
  request.save();
  item.save();
}

export function handleAppealPossible(event: AppealPossible): void {
  let registry = LRegistry.load(event.params._arbitrable.toHexString());
  if (registry == null) return; // Event not related to a GTCR.

  let tcr = LightGeneralizedTCR.bind(event.params._arbitrable);
  let itemID = tcr.arbitratorDisputeIDToItemID(
    event.address,
    event.params._disputeID,
  );
  let graphItemID =
    itemID.toHexString() + '@' + event.params._arbitrable.toHexString();
  let item = LItem.load(graphItemID);
  if (!item) {
    log.error(`Appeal Possible LItem {} not found. tx {}`, [
      graphItemID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  let requestID =
    item.id + '-' + item.numberOfRequests.minus(BigInt.fromI32(1)).toString();
  let request = LRequest.load(requestID);
  if (!request) {
    log.error(`Appeal Possible LRequest {} not found. tx {}`, [
      requestID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  let roundID =
    request.id +
    '-' +
    request.numberOfRounds.minus(BigInt.fromI32(1)).toString();
  let round = LRound.load(roundID);
  if (!round) {
    log.error(`Appeal Possible LRound {} not found. tx {}`, [
      roundID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  let arbitrator = IArbitrator.bind(event.address);
  let appealPeriod = arbitrator.appealPeriod(event.params._disputeID);
  round.appealPeriodStart = appealPeriod.value0;
  round.appealPeriodEnd = appealPeriod.value1;
  round.rulingTime = event.block.timestamp;
  round.txHashAppealPossible = event.transaction.hash;

  let currentRuling = arbitrator.currentRuling(request.disputeID);
  round.ruling = currentRuling.equals(BigInt.fromI32(0))
    ? NONE
    : currentRuling.equals(BigInt.fromI32(1))
    ? ACCEPT
    : REJECT;

  round.save();
}

export function handleAppealDecision(event: AppealDecision): void {
  let registry = LRegistry.load(event.params._arbitrable.toHexString());
  if (registry == null) return; // Event not related to a GTCR.

  let tcr = LightGeneralizedTCR.bind(event.params._arbitrable);
  let itemID = tcr.arbitratorDisputeIDToItemID(
    event.address,
    event.params._disputeID,
  );
  let graphItemID =
    itemID.toHexString() + '@' + event.params._arbitrable.toHexString();
  let item = LItem.load(graphItemID);
  if (!item) {
    log.error(`Appeal Decision LItem {} not found. tx {}`, [
      graphItemID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  let requestID =
    item.id + '-' + item.numberOfRequests.minus(BigInt.fromI32(1)).toString();
  let request = LRequest.load(requestID);
  if (!request) {
    log.error(`Appeal Decision LRequest {} not found. tx {}`, [
      requestID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  let roundID =
    request.id +
    '-' +
    request.numberOfRounds.minus(BigInt.fromI32(1)).toString();
  let round = LRound.load(roundID);
  if (!round) {
    log.error(`Appeal Decision LRound {} not found. tx {}`, [
      roundID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  round.appealed = true;
  round.appealedAt = event.block.timestamp;
  round.txHashAppealDecision = event.transaction.hash;

  // create new round
  let newRoundID = request.id + '-' + request.numberOfRounds.toString();
  let newRound = buildNewRound(newRoundID, request.id, event.block.timestamp);

  round.save();
  newRound.save();

  request.numberOfRounds = request.numberOfRounds.plus(BigInt.fromI32(1));
  request.save();
}

export function handleStatusUpdated(event: ItemStatusChange): void {
  // This handler is used to handle transations to item statuses 0 and 1.
  // All other status updates are handled elsewhere.
  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemInfo = tcr.getItemInfo(event.params._itemID);
  if (
    itemInfo.value0 == REGISTRATION_REQUESTED_CODE ||
    itemInfo.value0 == CLEARING_REQUESTED_CODE
  ) {
    // LRequest not yet resolved. No-op as changes are handled
    // elsewhere.
    return;
  }

  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  let item = LItem.load(graphItemID);
  if (!item) {
    log.error(`LItem {} not found.`, [graphItemID]);
    return;
  }

  // We take the previous and new extended statuses for accounting purposes.
  let previousStatus = getExtendedStatus(item.disputed, item.status);
  item.status = getStatus(itemInfo.value0);
  item.disputed = false;
  let newStatus = getExtendedStatus(item.disputed, item.status);

  if (previousStatus != newStatus) {
    // Accounting.
    updateCounters(previousStatus, newStatus, event.address);
  }

  if (event.params._updatedDirectly) {
    // Direct actions (e.g. addItemDirectly and removeItemDirectly)
    // don't envolve any requests. Only the item is updated.
    item.save();

    return;
  }

  item.latestRequestResolutionTime = event.block.timestamp;

  let requestIndex = item.numberOfRequests.minus(BigInt.fromI32(1));
  let requestInfo = tcr.getRequestInfo(event.params._itemID, requestIndex);

  let requestID = graphItemID + '-' + requestIndex.toString();
  let request = LRequest.load(requestID);
  if (!request) {
    log.error(`LRequest {} not found.`, [requestID]);
    return;
  }

  request.resolved = true;
  request.resolutionTime = event.block.timestamp;
  request.resolutionTx = event.transaction.hash;
  // requestInfo.value6 is request.ruling.
  request.disputeOutcome = getFinalRuling(requestInfo.value6);

  // Iterate over every contribution and mark it as withdrawable if it is.
  // Start from the second round as the first is automatically withdrawn
  // when the request resolves.
  for (
    let i = BigInt.fromI32(1);
    i.lt(request.numberOfRounds);
    i = i.plus(BigInt.fromI32(1))
  ) {
    // Iterate over every round of the request.
    let roundID = requestID + '-' + i.toString();
    let round = LRound.load(roundID);
    if (!round) {
      log.error(`LRound {} not found.`, [roundID]);
      return;
    }

    for (
      let j = BigInt.fromI32(0);
      j.lt(round.numberOfContributions);
      j = j.plus(BigInt.fromI32(1))
    ) {
      // Iterate over every contribution of the round.
      let contributionID = roundID + '-' + j.toString();
      let contribution = LContribution.load(contributionID);
      if (!contribution) {
        log.error(`LContribution {} not found.`, [contributionID]);
        return;
      }

      if (requestInfo.value6 == NO_RULING_CODE) {
        // The final ruling is refuse to rule. There is no winner
        // or loser so every contribution is withdrawable.
        contribution.withdrawable = true;
      } else if (requestInfo.value6 == REQUESTER_CODE) {
        // The requester won so only contributions to the requester
        // are withdrawable.
        // The only exception is in the case the last round the loser
        // (challenger in this case) raised some funds but not enough
        // to be fully funded before the deadline. In this case
        // the contributors get to withdraw.
        if (contribution.side == BigInt.fromI32(REQUESTER_CODE)) {
          contribution.withdrawable = true;
        } else if (i.equals(request.numberOfRounds.minus(BigInt.fromI32(1)))) {
          // Contribution was made to the challenger (loser) and this
          // is the last round.
          contribution.withdrawable = true;
        }
      } else {
        // The challenger won so only contributions to the challenger
        // are withdrawable.
        // The only exception is in the case the last round the loser
        // (requester in this case) raised some funds but not enough
        // to be fully funded before the deadline. In this case
        // the contributors get to withdraw.
        if (contribution.side == BigInt.fromI32(CHALLENGER_CODE)) {
          contribution.withdrawable = true;
        } else if (i.equals(request.numberOfRounds.minus(BigInt.fromI32(1)))) {
          // Contribution was made to the requester (loser) and this
          // is the last round.
          contribution.withdrawable = true;
        }
      }

      contribution.save();
    }
  }

  request.save();
  item.save();
}

export function handleRewardWithdrawn(event: RewardWithdrawn): void {
  let graphItemID =
    event.params._itemID.toHexString() + '@' + event.address.toHexString();
  let requestID = graphItemID + '-' + event.params._request.toString();
  let roundID = requestID + '-' + event.params._round.toString();
  let round = LRound.load(roundID);
  if (!round) {
    log.error(`LRound {} not found.`, [roundID]);
    return;
  }

  for (
    let i = BigInt.fromI32(0);
    i.lt(round.numberOfContributions);
    i = i.plus(BigInt.fromI32(1))
  ) {
    let contributionID = roundID + '-' + i.toString();
    let contribution = LContribution.load(contributionID);
    if (!contribution) {
      log.error(`LContribution {} not found.`, [contributionID]);
      return;
    }
    // Check if the contribution is from the beneficiary.

    if (
      contribution.contributor.toHexString() !=
      event.params._beneficiary.toHexString()
    )
      continue;

    contribution.withdrawable = false;
    contribution.save();
  }
}

export function handleMetaEvidence(event: MetaEvidenceEvent): void {
  let registry = LRegistry.load(event.address.toHexString());
  if (!registry) {
    log.error(`LRegistry {} not found.`, [event.address.toHexString()]);
    return;
  }

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
    let arbitrator = LArbitrator.load(arbitratorAddr.toHexString());
    if (!arbitrator) {
      IArbitratorDataSourceTemplate.create(arbitratorAddr);
      arbitrator = new LArbitrator(arbitratorAddr.toHexString());
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

  const ipfsHash = extractPath(event.params._evidence);
  registry.metadata = `${ipfsHash}-${event.address.toHexString()}-${
    registry.metaEvidenceCount
  }`;

  const context = new DataSourceContext();
  context.setString('address', event.address.toHexString());
  context.setBigInt('count', registry.metaEvidenceCount);

  LRegistryMetadataTemplate.createWithContext(ipfsHash, context);

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

export function handleConnectedTCRSet(event: ConnectedTCRSetEvent): void {
  let registry = LRegistry.load(event.address.toHexString());
  if (!registry) {
    log.error(`LRegistry {} not found.`, [event.address.toHexString()]);
    return;
  }
  registry.connectedTCR = event.params._connectedTCR;

  registry.save();
}

export function handleEvidence(event: EvidenceEvent): void {
  let evidenceGroupId =
    event.params._evidenceGroupID.toString() +
    '@' +
    event.address.toHexString();
  let evidenceGroup = EvidenceGroup.load(evidenceGroupId);
  if (!evidenceGroup) {
    // Evidence was emitted before the evidence group was created. Create group
    evidenceGroup = new EvidenceGroup(
      event.params._evidenceGroupID.toString() +
        '@' +
        event.address.toHexString(),
    );
    // Will be created with 0 evidence, will increment to 1 within this handler.
    evidenceGroup.numberOfEvidence = BigInt.fromI32(0);
  }

  let evidence = new Evidence(
    evidenceGroupId + '-' + evidenceGroup.numberOfEvidence.toString(),
  );

  evidence.arbitrator = event.params._arbitrator;
  evidence.evidenceGroup = evidenceGroupId;
  evidence.party = event.params._party;
  evidence.URI = event.params._evidence;
  evidence.number = evidenceGroup.numberOfEvidence;
  evidence.timestamp = event.block.timestamp;
  evidence.txHash = event.transaction.hash;

  evidenceGroup.numberOfEvidence = evidenceGroup.numberOfEvidence.plus(
    BigInt.fromI32(1),
  );

  const ipfsHash = extractPath(event.params._evidence);
  evidence.metadata = `${ipfsHash}-${evidence.id}`;

  const context = new DataSourceContext();
  context.setString('evidenceId', evidence.id);
  EvidenceMetadataTemplate.createWithContext(ipfsHash, context);

  evidenceGroup.save();
  evidence.save();
}

export function handleRuling(event: Ruling): void {
  let tcr = LightGeneralizedTCR.bind(event.address);
  let itemID = tcr.arbitratorDisputeIDToItemID(
    event.params._arbitrator,
    event.params._disputeID,
  );
  let graphItemID = itemID.toHexString() + '@' + event.address.toHexString();
  let item = LItem.load(graphItemID);
  if (!item) {
    log.error(`Ruling LItem {} not found. tx {}`, [
      graphItemID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  let requestID =
    item.id + '-' + item.numberOfRequests.minus(BigInt.fromI32(1)).toString();
  let request = LRequest.load(requestID);
  if (!request) {
    log.error(`Ruling LRequest {} not found. tx {}`, [
      requestID,
      event.transaction.hash.toHexString(),
    ]);
    return;
  }

  request.finalRuling = event.params._ruling;
  request.resolutionTime = event.block.timestamp;
  request.save();
}
