/**
 * Bootstrap ships no types for its prebuilt bundle.
 *
 * The bundle is imported purely for its side effect (registering the data-api
 * handlers for dropdowns, modals, offcanvas and tooltips), so an empty
 * declaration is enough. Install @types/bootstrap only if you start
 * constructing components imperatively, e.g. `new Modal(el)`.
 */
declare module 'bootstrap/dist/js/bootstrap.bundle.min.js'
