import { Bytes, dataSource, json, log } from '@graphprotocol/graph-ts';
import { EvidenceMetadata } from '../../generated/schema';

export function handleLGTCREvidenceMetadata(content: Bytes): void {
  const id = dataSource.stringParam();
  const context = dataSource.context();
  const evidenceId = context.getString('evidenceId');

  const evidence = new EvidenceMetadata(`${id}-${evidenceId}`);
  const value = json.fromBytes(content).toObject();

  log.debug(`ipfs hash : {}, content : {}`, [id, content.toString()]);

  if (!value) {
    log.warning(`Error converting object for evidence {}`, [id]);
    evidence.save();
    return;
  }

  const nameValue = value.get('name');
  if (!nameValue) {
    log.warning(`Error getting name value for evidence {}`, [id]);
  } else {
    evidence.name = nameValue.toString();
  }

  const titleValue = value.get('title');
  if (!titleValue) {
    log.warning(`Error getting title value for evidence {}`, [id]);
  } else {
    evidence.title = titleValue.toString();
  }

  const descriptionValue = value.get('description');
  if (!descriptionValue) {
    log.warning(`Error getting description value for evidence {}`, [id]);
  } else {
    evidence.description = descriptionValue.toString();
  }

  const fileURIValue = value.get('fileURI');
  if (!fileURIValue) {
    log.warning(`Error getting fileURI value for evidence {}`, [id]);
  } else {
    evidence.fileURI = fileURIValue.toString();
  }

  const fileTypeExtensionValue = value.get('fileTypeExtension');
  if (!fileTypeExtensionValue) {
    log.warning(`Error getting fileTypeExtension value for evidence {}`, [id]);
  } else {
    evidence.fileTypeExtension = fileTypeExtensionValue.toString();
  }

  evidence.save();
}
