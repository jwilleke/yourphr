export const environment = {
  production: true,
  environment_cloud: false,
  environment_desktop: true,
  popup_source_auth: false,

  //used to specify the api server that we're going to use (can be relative or absolute). Must not have trailing slash
  fasten_api_endpoint_base: '/api',

  // NOTE: the SMART OAuth relay is deliberately NOT configured here. redirect_uri is derived by the
  // backend at runtime (relay.public_url / YOURPHR_RELAY_PUBLIC_URL), so a self-hosted relay needs
  // no frontend rebuild (#399).
};
