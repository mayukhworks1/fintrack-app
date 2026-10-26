// Artifacts: interactive mini-apps kept as pages (content_type "artifact").
//
// ArtifactFrame is the embedding contract for anything that shows an artifact
// inside another surface (a document block, a dashboard): pass a slug, or a
// page id with an optional render token, and a height.
export { default as ArtifactFrame, artifactRenderUrl } from './ArtifactFrame'
export { default as ArtifactStudio } from './ArtifactStudio'
export { default as ArtifactTemplates } from './ArtifactTemplates'
export { ARTIFACT_TEMPLATES } from './templates'
export { ARTIFACT_TYPE, streamArtifact } from './artifactAi'
