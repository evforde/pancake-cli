import { expect } from 'chai';
import tmp from 'tmp';
import * as fs from 'fs-extra';
import {
  TProfile,
  userConfigFactory,
} from '../../../src/lib/spiffy/user_config_spf';

// Test cases for userConfigFactory with a focus on the profile helper functions.
describe('userConfigFactory', () => {
  let originalEnv: { [key: string]: string | undefined };
  let configPath: string;
  let tmpDir: tmp.DirResult;

  beforeEach(() => {
    originalEnv = { ...process.env };
    tmpDir = tmp.dirSync();
    configPath = `${tmpDir.name}/config.json`;
  });

  afterEach(() => {
    Object.assign(process.env, originalEnv);
    fs.removeSync(configPath);
    fs.emptyDirSync(tmpDir.name);
    tmpDir.removeCallback();
  });

  const testCases = [
    {
      // Default profile case.
      envVars: {},
      profile: {
        alternativeProfiles: [
          {
            name: 'default',
            hostPrefix: 'prod',
            fpAuthToken: '123',
          } as TProfile,
        ],
      },
      results: {
        apiServer: 'https://api.prod.graphite.dev/v1',
        appServer: 'https://app.prod.graphite.dev',
        fpAuthToken: '123',
      },
    },
    {
      // Case with no alternative profiles.
      envVars: {},
      profile: {
        fpAuthToken: '123',
      },
      results: {
        apiServer: 'https://api.graphite.dev/v1',
        appServer: 'https://app.graphite.dev',
        fpAuthToken: '123',
      },
    },
    {
      // Case testing a staging profile.
      envVars: { GRAPHITE_PROFILE: 'STAGING' },
      profile: {
        alternativeProfiles: [
          {
            name: 'STAGING',
            hostPrefix: 'stg',
            fpAuthToken: '234',
          } as TProfile,
        ],
      },
      results: {
        apiServer: 'https://api.stg.graphite.dev/v1',
        appServer: 'https://app.stg.graphite.dev',
        fpAuthToken: '234',
      },
    },
  ];
  testCases.forEach((data) => {
    it('Can read the expected values from a user config profile', () => {
      Object.assign(process.env, { ...originalEnv, ...data.envVars });
      fs.writeFileSync(configPath, JSON.stringify(data.profile));
      const userConfig = userConfigFactory.load(configPath);
      expect(userConfig.getApiServerUrl()).to.equal(data.results.apiServer);
      expect(userConfig.getAppServerUrl()).to.equal(data.results.appServer);
      expect(userConfig.getFPAuthToken()).to.equal(data.results.fpAuthToken);
    });
  });
});
