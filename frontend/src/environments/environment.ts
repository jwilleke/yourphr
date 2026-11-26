// This file can be replaced during build by using the `fileReplacements` array.
// `ng build --prod` replaces `environment.ts` with `environment.prod.ts`.
// The list of file replacements can be found in `angular.json`.

export const environment = {
  //javascript environment, not Fasten env.
  production: false,

  // is the application running in the cloud? (enables 3rd party IdP's and token based couchdb authentication)
  environment_cloud: false,

  // is the application running in a desktop environment (Wails). If so we will use hash based routing
  environment_desktop: false,
  //when environment_desktop=true, we can use the postMessage api to communicate with the desktop app (otherwise use redirects)
  popup_source_auth: false,

  //specify the connect gateway server that we're going to use to authenticate against all our source/providers. Must not have trailing slash

  //used to specify the api server that we're going to use (can be relative or absolute). Must not have trailing slash
  // if relative, must start with /
  fasten_api_endpoint_base: '/api',

  // NOTE: the SMART OAuth relay is deliberately NOT configured here. redirect_uri is derived by the
  // backend at runtime (relay.public_url / YOURPHR_RELAY_PUBLIC_URL), so a self-hosted relay needs
  // no frontend rebuild (#399).
};
