import { RemovalPolicy, Stack, Validations } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnFunction, Function } from 'aws-cdk-lib/aws-lambda';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CustomResource, Duration, IResource } from 'aws-cdk-lib/core';
import { Provider } from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { DEFAULT_LOG_REMOVAL_POLICY, DEFAULT_LOG_RETENTION, createLogGroup } from '../log-groups';
import { SecretRetrieverFunction } from './secret-retriever-function';
import { acknowledgeGranularFinding } from '../suppress-nags';

// The AWSLambdaBasicExecutionRole ARN pattern is the same for every Lambda
// function using the default execution role, regardless of the consumer's
// own construct IDs -- safe to acknowledge literally.
const AWS_LAMBDA_BASIC_EXECUTION_ROLE_IAM4 =
  'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]';

export interface Secret {
  username: string;
  password: string;
}

export interface SecretRetrieverOptionsBase {
  readonly secretArn: string;

  /**
   * How long the logs of the Lambda functions are kept
   *
   * @default RetentionDays.FIVE_DAYS
   */
  readonly logRetention?: RetentionDays;

  /**
   * What happens to the log groups when the stack is deleted
   *
   * @default RemovalPolicy.DESTROY
   */
  readonly logRemovalPolicy?: RemovalPolicy;
}

export interface SecretRetrieverOptions extends SecretRetrieverOptionsBase {}

export abstract class SecretRetriever {
  public static new(options: SecretRetrieverOptions): SecretRetriever {
    return new (class extends SecretRetriever {
      public _bind(scope: Construct): SecretRetriever {
        const secretRetriever = new CustomResourceSecretRetriever(scope, {
          secretArn: options.secretArn,
          logRetention: options.logRetention,
          logRemovalPolicy: options.logRemovalPolicy,
        });

        return secretRetriever;
      }
    })();
  }

  public secretArn!: string;

  /**
   * The ARN of the secretRetriever in SSM.
   */
  public secretRetrieverArn!: string;

  /**
   * The plaintext secret
   */
  public secretPlaintext!: Secret;
  public secretPasswordPlaintext!: string;
  public customResource!: IResource;

  /**
   * @internal
   */
  protected constructor() {}

  /**
   * @internal
   */
  public abstract _bind(scope: Construct): any;
}

interface CustomResourceSecretRetrieverOptions extends SecretRetrieverOptions {}

class CustomResourceSecretRetriever extends SecretRetriever {
  constructor(scope: Construct, options: CustomResourceSecretRetrieverOptions) {
    super();

    this.secretArn = options.secretArn;
    const logRetention = options.logRetention ?? DEFAULT_LOG_RETENTION;
    const logRemovalPolicy = options.logRemovalPolicy ?? DEFAULT_LOG_REMOVAL_POLICY;

    const onEvent: Function = new SecretRetrieverFunction(
      scope,
      'SecretRetrieverOnEventHandler',
      {
        timeout: Duration.seconds(10),
        memorySize: 128,
        logGroup: createLogGroup(scope, 'SecretRetrieverOnEventLogGroup', logRetention, logRemovalPolicy),
      },
    );
    acknowledgeGranularFinding(
      onEvent,
      AWS_LAMBDA_BASIC_EXECUTION_ROLE_IAM4,
      'For this event handler we do not need to restrict managed policies',
    );
    Validations.of(onEvent).acknowledge({
      id: 'AwsSolutions-L1',
      reason: 'For this lambda the latest runtime is not needed',
    });

    onEvent.addToRolePolicy(
      new PolicyStatement({
        actions: ['secretsmanager:GetSecretValue'],
        resources: [this.secretArn],
      }),
    );

    const provider = new Provider(scope, 'SecretRetrieveProvider', {
      onEventHandler: onEvent,
      logGroup: createLogGroup(scope, 'SecretRetrieveProviderLogGroup', logRetention, logRemovalPolicy),
    });
    acknowledgeGranularFinding(
      provider,
      AWS_LAMBDA_BASIC_EXECUTION_ROLE_IAM4,
      'For this provider we do not need to restrict managed policies',
    );
    // cdk-nag v3 requires the exact granular finding id (no prefix/bulk
    // suppression) -- resolve onEvent's CloudFormation logical id at
    // synth time instead of hardcoding it.
    const onEventLogicalId = Stack.of(onEvent).getLogicalId(
      onEvent.node.defaultChild as CfnFunction,
    );
    Validations.of(provider).acknowledge(
      {
        id: `AwsSolutions-IAM5[Resource::<${onEventLogicalId}.Arn>:*]`,
        reason: 'For this provider wildcards are fine',
      },
      {
        id: 'AwsSolutions-L1',
        reason: 'For this provider the latest runtime is not needed',
      },
    );

    const resource = new CustomResource(
      scope,
      'SecretRetrieverCustomResource',
      {
        serviceToken: provider.serviceToken,
        properties: {
          SecretArn: options.secretArn,
          ServiceTimeout: 305,
        },
      },
    );

    this.secretPlaintext = resource.getAtt('secretValue').toJSON() as Secret;
    this.secretPasswordPlaintext = resource.getAttString('secretPasswordValue');
    this.customResource = resource;
  }

  public _bind() {}
}
