import sequential from 'promise-sequential';
import { ManuallyTimedCodePath, stateManager, $TSAny, $TSMeta, $TSContext, AmplifyFault, constants, spinner } from 'amplify-cli-core';
import { printer } from 'amplify-prompts';
import { ensureEnvParamManager, IEnvironmentParameterManager, ServiceDownloadHandler } from '@aws-amplify/amplify-environment-parameters';

import { getProviderPlugins } from './extensions/amplify-helpers/get-provider-plugins';

/**
 * Entry point for initializing an environment. Delegates out to plugins initEnv function
 */
export const initializeEnv = async (
  context: $TSContext,
  currentAmplifyMeta: $TSMeta = stateManager.currentMetaFileExists() ? stateManager.getCurrentMeta() : undefined,
): Promise<void> => {
  const currentEnv = context.exeInfo.localEnvInfo.envName;
  const isPulling = context.input.command === 'pull' || (context.input.command === 'env' && context.input.subCommands?.[0] === 'pull');

  try {
    const { projectPath } = context.exeInfo.localEnvInfo;

    const amplifyMeta: $TSMeta = { providers: {} };
    const teamProviderInfo = stateManager.getTeamProviderInfo(projectPath);

    amplifyMeta.providers.awscloudformation = teamProviderInfo?.[currentEnv]?.awscloudformation;

    const envParamManager = (await ensureEnvParamManager(currentEnv)).instance;
    const { providers } = stateManager.getProjectConfig(undefined, { throwIfNotExist: false, default: {} });
    const CloudFormationProviderName = constants.DEFAULT_PROVIDER;
    if (Array.isArray(providers) && providers.find((value) => value === CloudFormationProviderName)) {
      const downloadHandler: ServiceDownloadHandler = await context.amplify.invokePluginMethod(
        context,
        CloudFormationProviderName,
        undefined,
        'getEnvParametersDownloadHandler',
        [context],
      );
      await envParamManager.downloadParameters(downloadHandler);
    }

    if (!context.exeInfo.restoreBackend) {
      mergeBackendConfigIntoAmplifyMeta(projectPath, amplifyMeta);
      mergeCategoryEnvParamsIntoAmplifyMeta(envParamManager, amplifyMeta, 'hosting', 'ElasticContainer');
      stateManager.setMeta(projectPath, amplifyMeta);
    }

    const categoryInitializationTasks: (() => Promise<$TSAny>)[] = [];

    const initializedCategories = Object.keys(stateManager.getMeta());
    const categoryPluginInfoList = context.amplify.getAllCategoryPluginInfo(context);
    const availableCategories = Object.keys(categoryPluginInfoList).filter((key) => initializedCategories.includes(key));

    const importCategoryPluginAndQueueInitEnvTask = async (pluginInfo, category): Promise<void> => {
      try {
        const { initEnv } = await import(pluginInfo.packageLocation);

        if (initEnv) {
          categoryInitializationTasks.push(() => initEnv(context));
        }
      } catch (e) {
        throw new AmplifyFault(
          'PluginNotLoadedFault',
          {
            message: `Could not load plugin for category ${category}.`,
            resolution: `Review the error message and stack trace for additional information.`,
          },
          e,
        );
      }
    };
    for (const category of availableCategories) {
      for (const pluginInfo of categoryPluginInfoList[category]) {
        await importCategoryPluginAndQueueInitEnvTask(pluginInfo, category);
      }
    }

    const providerPlugins = getProviderPlugins(context);

    const initializationTasks: (() => Promise<$TSAny>)[] = [];
    const providerPushTasks: (() => Promise<$TSAny>)[] = [];

    for (const provider of context.exeInfo?.projectConfig?.providers) {
      try {
        const providerModule = await import(providerPlugins[provider]);
        initializationTasks.push(() => providerModule.initEnv(context, amplifyMeta.providers[provider]));
      } catch (e) {
        throw new AmplifyFault(
          'PluginNotLoadedFault',
          {
            message: `Could not load plugin for provider ${provider}.`,
            resolution: 'Review the error message and stack trace for additional information.',
          },
          e,
        );
      }
    }

    spinner.start(
      isPulling ? `Fetching updates to backend environment: ${currentEnv} from the cloud.` : `Initializing your environment: ${currentEnv}`,
    );

    try {
      context.usageData.startCodePathTimer(ManuallyTimedCodePath.INIT_ENV_PLATFORM);
      await sequential(initializationTasks);
    } catch (e) {
      spinner.fail();
      throw new AmplifyFault(
        'ProjectInitFault',
        {
          message: `Could not initialize platform for '${currentEnv}': ${e.message}`,
          resolution: 'Review the error message and stack trace for additional information.',
        },
        e,
      );
    } finally {
      context.usageData.stopCodePathTimer(ManuallyTimedCodePath.INIT_ENV_PLATFORM);
    }

    spinner.succeed(
      isPulling ? `Successfully pulled backend environment ${currentEnv} from the cloud.` : 'Initialized provider successfully.',
    );

    const projectDetails = context.amplify.getProjectDetails();

    context.exeInfo ??= {};
    Object.assign(context.exeInfo, projectDetails);

    try {
      context.usageData.startCodePathTimer(ManuallyTimedCodePath.INIT_ENV_CATEGORIES);
      await sequential(categoryInitializationTasks);
    } catch (e) {
      throw new AmplifyFault(
        'ProjectInitFault',
        {
          message: `Could not initialize categories for '${currentEnv}': ${e.message}`,
          resolution: 'Review the error message and stack trace for additional information.',
        },
        e,
      );
    } finally {
      context.usageData.stopCodePathTimer(ManuallyTimedCodePath.INIT_ENV_CATEGORIES);
    }

    if (context.exeInfo.forcePush === undefined) {
      context.exeInfo.forcePush = await context.amplify.confirmPrompt(
        'Do you want to push your resources to the cloud for your environment?',
      );
    }

    if (context.exeInfo.forcePush) {
      for (const provider of context.exeInfo.projectConfig.providers) {
        const providerModule = await import(providerPlugins[provider]);

        const resourceDefinition = await context.amplify.getResourceStatus(undefined, undefined, provider);
        providerPushTasks.push(() => providerModule.pushResources(context, resourceDefinition));
      }

      await sequential(providerPushTasks);
    }

    // Generate AWS exports/configuration file
    await context.amplify.onCategoryOutputsChange(context, currentAmplifyMeta);

    printer.success(isPulling ? '' : 'Initialized your environment successfully.');
  } catch (e) {
    // let the error propagate up after we safely exit the spinner
    spinner.fail('There was an error initializing your environment.');
    throw e;
  }
};

const mergeBackendConfigIntoAmplifyMeta = (projectPath: string, amplifyMeta: $TSMeta): void => {
  const backendConfig = stateManager.getBackendConfig(projectPath);
  Object.assign(amplifyMeta, backendConfig);
};

const mergeCategoryEnvParamsIntoAmplifyMeta = (
  envParamManager: IEnvironmentParameterManager,
  amplifyMeta: $TSMeta,
  category: string,
  serviceName: string,
): void => {
  if (
    envParamManager.hasResourceParamManager(category, serviceName) &&
    envParamManager.getResourceParamManager(category, serviceName).hasAnyParams()
  ) {
    Object.assign(amplifyMeta[category][serviceName], envParamManager.getResourceParamManager(category, serviceName).getAllParams());
  }
};
