import { defineRelations } from "drizzle-orm";

import * as schema from "./legislation";

export const relations = defineRelations(schema, (r) => ({
  legislativeSources: {
    documents: r.many.legalDocuments({
      from: r.legislativeSources.sourceId,
      to: r.legalDocuments.sourceId,
    }),
    syncRuns: r.many.syncRuns({
      from: r.legislativeSources.sourceId,
      to: r.syncRuns.sourceId,
    }),
  },
  legalDocuments: {
    source: r.one.legislativeSources({
      from: r.legalDocuments.sourceId,
      to: r.legislativeSources.sourceId,
    }),
    fragments: r.many.senseFragments({
      from: r.legalDocuments.docId,
      to: r.senseFragments.docId,
    }),
    versions: r.many.documentVersions({
      from: r.legalDocuments.docId,
      to: r.documentVersions.docId,
    }),
    events: r.many.legislativeEvents({
      from: r.legalDocuments.docId,
      to: r.legislativeEvents.docId,
    }),
    outgoingAnchors: r.many.referenceAnchors({
      from: r.legalDocuments.docId,
      to: r.referenceAnchors.sourceDocId,
      alias: "sourceRefs",
    }),
    incomingAnchors: r.many.referenceAnchors({
      from: r.legalDocuments.docId,
      to: r.referenceAnchors.targetDocId,
      alias: "targetRefs",
    }),
    parentBulletin: r.one.legalDocuments({
      from: r.legalDocuments.parentBulletinId,
      to: r.legalDocuments.docId,
    }),
    repealedBy: r.one.legalDocuments({
      from: r.legalDocuments.repealedByDocId,
      to: r.legalDocuments.docId,
    }),
    consolidates: r.one.legalDocuments({
      from: r.legalDocuments.consolidatesDocId,
      to: r.legalDocuments.docId,
    }),
  },
  documentVersions: {
    document: r.one.legalDocuments({
      from: r.documentVersions.docId,
      to: r.legalDocuments.docId,
    }),
    fragments: r.many.senseFragments({
      from: r.documentVersions.versionId,
      to: r.senseFragments.versionId,
    }),
  },
  legislativeEvents: {
    document: r.one.legalDocuments({
      from: r.legislativeEvents.docId,
      to: r.legalDocuments.docId,
    }),
  },
  senseFragments: {
    document: r.one.legalDocuments({
      from: r.senseFragments.docId,
      to: r.legalDocuments.docId,
    }),
    version: r.one.documentVersions({
      from: r.senseFragments.versionId,
      to: r.documentVersions.versionId,
    }),
    outgoingAnchors: r.many.referenceAnchors({
      from: r.senseFragments.fragmentId,
      to: r.referenceAnchors.sourceFragmentId,
      alias: "fragmentSourceRefs",
    }),
    embeddings: r.many.embeddingCache({
      from: r.senseFragments.fragmentId,
      to: r.embeddingCache.fragmentId,
    }),
  },
  referenceAnchors: {
    sourceDoc: r.one.legalDocuments({
      from: r.referenceAnchors.sourceDocId,
      to: r.legalDocuments.docId,
      alias: "sourceRefs",
    }),
    targetDoc: r.one.legalDocuments({
      from: r.referenceAnchors.targetDocId,
      to: r.legalDocuments.docId,
      alias: "targetRefs",
    }),
    sourceFragment: r.one.senseFragments({
      from: r.referenceAnchors.sourceFragmentId,
      to: r.senseFragments.fragmentId,
      alias: "fragmentSourceRefs",
    }),
  },
  legalPaths: {
    startDoc: r.one.legalDocuments({
      from: r.legalPaths.startDocId,
      to: r.legalDocuments.docId,
    }),
    endDoc: r.one.legalDocuments({
      from: r.legalPaths.endDocId,
      to: r.legalDocuments.docId,
    }),
  },
  syncRuns: {
    source: r.one.legislativeSources({
      from: r.syncRuns.sourceId,
      to: r.legislativeSources.sourceId,
    }),
  },
  embeddingCache: {
    fragment: r.one.senseFragments({
      from: r.embeddingCache.fragmentId,
      to: r.senseFragments.fragmentId,
    }),
  },
}));
