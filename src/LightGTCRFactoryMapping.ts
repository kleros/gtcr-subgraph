/* eslint-disable prefer-const */
import { BigInt } from '@graphprotocol/graph-ts';
import { NewGTCR } from '../generated/LightGTCRFactory/LightGTCRFactory';
import { MetaEvidence, LRegistry } from '../generated/schema';
import { LightGeneralizedTCR as LightGeneralizedTCRDataSource } from '../generated/templates';
import { IArbitrator } from '../generated/templates/IArbitrator/IArbitrator';
import { LightGeneralizedTCR } from '../generated/templates/LightGeneralizedTCR/LightGeneralizedTCR';

export function handleNewGTCR(event: NewGTCR): void {
  LightGeneralizedTCRDataSource.create(event.params._address);

  let registry = new LRegistry(event.params._address.toHexString());

  let tcr = LightGeneralizedTCR.bind(event.params._address);

  let registrationMetaEvidence = new MetaEvidence(registry.id + '-1');
  registrationMetaEvidence.URI = '';
  registrationMetaEvidence.timestamp = event.block.timestamp;
  registrationMetaEvidence.tcrAddress = event.params._address;
  registrationMetaEvidence.save();

  let clearingMetaEvidence = new MetaEvidence(registry.id + '-2');
  clearingMetaEvidence.URI = '';
  clearingMetaEvidence.timestamp = event.block.timestamp;
  clearingMetaEvidence.tcrAddress = event.params._address;
  clearingMetaEvidence.save();

  registry.metaEvidenceCount = BigInt.fromI32(0);
  registry.registrationMetaEvidence = registrationMetaEvidence.id;
  registry.clearingMetaEvidence = clearingMetaEvidence.id;
  registry.numberOfAbsent = BigInt.fromI32(0);
  registry.numberOfRegistered = BigInt.fromI32(0);
  registry.numberOfRegistrationRequested = BigInt.fromI32(0);
  registry.numberOfClearingRequested = BigInt.fromI32(0);
  registry.numberOfChallengedRegistrations = BigInt.fromI32(0);
  registry.numberOfChallengedClearing = BigInt.fromI32(0);
  registry.challengePeriodDuration = tcr.challengePeriodDuration();

  let arbitrator = IArbitrator.bind(tcr.arbitrator());
  let arbitrationCost = arbitrator.arbitrationCost(tcr.arbitratorExtraData());
  registry.arbitrationCost = arbitrationCost;

  let submissionBaseDeposit = tcr.submissionBaseDeposit();
  let removalBaseDeposit = tcr.removalBaseDeposit();
  let submissionChallengeBaseDeposit = tcr.submissionChallengeBaseDeposit();
  let removalChallengeBaseDeposit = tcr.removalChallengeBaseDeposit();

  registry.submissionBaseDeposit = submissionBaseDeposit;
  registry.submissionDeposit = submissionBaseDeposit.plus(arbitrationCost);
  registry.removalDeposit = removalBaseDeposit.plus(arbitrationCost);
  registry.removalBaseDeposit = removalBaseDeposit;
  registry.submissionChallengeDeposit = submissionChallengeBaseDeposit.plus(arbitrationCost);
  registry.removalChallengeDeposit = removalChallengeBaseDeposit.plus(arbitrationCost);

  registry.save();
}
