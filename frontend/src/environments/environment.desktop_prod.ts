export const environment = {
  production: true,
  environment_cloud: false,
  environment_desktop: true,
  environment_name: "desktop_prod",
  popup_source_auth: true,

  connect_gateway_api_endpoint_base: 'https://lighthouse.fastenhealth.com/v1',

  //used to specify the api server that we're going to use (can be relative or absolute). Must not have trailing slash
  fasten_api_endpoint_base: '/api',

  // self-hosted Go SMART OAuth store-and-poll relay; ${relay_endpoint_base}/callback is the OAuth redirect_uri (EPIC #20, issue #50)
  relay_endpoint_base: 'https://relay.nerdsbythehour.com',
};
