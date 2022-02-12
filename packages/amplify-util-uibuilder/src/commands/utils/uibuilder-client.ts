import { $TSContext, $TSAny } from 'amplify-cli-core';
import { AmplifyUIBuilder } from '@aws-sdk/client-amplifyuibuilder';
export { Component, Theme } from '@aws-sdk/client-amplifyuibuilder';

export const getAmplifyUIBuilderService = async (
  context: $TSContext,
  environmentName: string,
  appId: string,
): Promise<AmplifyUIBuilder> => {
  const awsConfigInfo = (await context.amplify.invokePluginMethod(context, 'awscloudformation', undefined, 'loadConfigurationForEnv', [
    context,
    environmentName,
    appId,
  ])) as $TSAny;

  if (process.env.UI_BUILDER_ENDPOINT) {
    awsConfigInfo.endpoint = process.env.UI_BUILDER_ENDPOINT;
  }

  if (process.env.UI_BUILDER_REGION) {
    awsConfigInfo.region = process.env.UI_BUILDER_REGION;
  }

  return new AmplifyUIBuilder(awsConfigInfo);
};