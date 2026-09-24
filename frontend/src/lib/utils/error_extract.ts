
//https://stackoverflow.com/a/18391400/1157633
export function extractErrorFromResponse(errResp: any): string {
  // The "" it used to be initialised with was overwritten on both paths and never read — ESLint 10's
  // no-useless-assignment says so, and it is right.
  if(errResp.name == "HttpErrorResponse" && errResp.error && errResp.error?.error){
    return errResp.error.error
  }
  return JSON.stringify(errResp, replaceErrors)
}

//stringify error objects
export function replaceErrors(key, value) {
  if (value instanceof Error) {
    const error = {};

    Object.getOwnPropertyNames(value).forEach(function (propName) {
      error[propName] = value[propName];
    });

    return error;
  }

  return value;
}
