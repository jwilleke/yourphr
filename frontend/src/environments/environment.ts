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

  // the environment name, `sandbox`, `prod`, `beta`
  environment_name: "sandbox",

  //specify the lighthouse server that we're going to use to authenticate against all our source/providers. Must not have trailing slash
  connect_gateway_api_endpoint_base: 'https://lighthouse.fastenhealth.com/sandbox',

  //used to specify the api server that we're going to use (can be relative or absolute). Must not have trailing slash
  // fasten_api_endpoint_base: 'https://api.sandbox.fastenhealth.com/v1',
  // if relative, must start with /
  fasten_api_endpoint_base: '/api',

  // self-hosted Go SMART OAuth store-and-poll relay; ${relay_endpoint_base}/callback is the OAuth redirect_uri (EPIC #20, issue #50)
  relay_endpoint_base: 'https://relay.nerdsbythehour.com',
};
