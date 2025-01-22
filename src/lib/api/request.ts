import { TRoute, request } from '@withgraphite/retyped-routes';
import * as t from '@withgraphite/retype';
import { TUserConfig } from '../spiffy/user_config_spf';

// eslint-disable-next-line max-params
export function requestWithArgs<TActualRoute extends TRoute>(
  userConfig: TUserConfig,
  route: TActualRoute,
  params: TActualRoute['rawBody'] extends true
    ? Buffer | Blob
    : t.UnwrapSchemaMap<TActualRoute['params']>,
  queryParams?: t.UnwrapSchemaMap<TActualRoute['queryParams']>,
  urlParams?: t.UnwrapSchemaMap<TActualRoute['urlParams']>,
  headers?: t.UnwrapSchemaMap<TActualRoute['headers']>
): Promise<
  t.UnwrapSchemaMap<TActualRoute['response']> & {
    _response: Response;
  }
> {
  const auth = userConfig.getFPAuthToken();

  return request.requestWithArgs(
    userConfig.getApiServerUrl(),
    route,
    params,
    queryParams,
    urlParams,
    {
      authorization: auth ? `token ${auth}` : undefined,
      ...headers,
    } as unknown as t.UnwrapSchemaMap<TActualRoute['headers']>
  );
}
