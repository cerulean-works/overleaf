import Settings from '@overleaf/settings'
import ProjectEditorHandler from '../../app/src/Features/Project/ProjectEditorHandler.mjs'
import ReviewRouter from './app/src/ReviewRouter.mjs'

// Availability describes the installed implementation, independently of any
// historical subscription flags in an imported user record.
ProjectEditorHandler.trackChangesAvailable = true

export default {
  router: ReviewRouter,
  hooks: {
    promises: {
      async getModuleProvidedFeatures() {
        return Settings.overleaf ? {} : { trackChanges: true }
      },
    },
  },
}
