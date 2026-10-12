import { RemovalPolicy, Validations } from 'aws-cdk-lib';
import { IPrefixList, PrefixList } from 'aws-cdk-lib/aws-ec2';
import {
  Effect,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { DEFAULT_LOG_REMOVAL_POLICY, DEFAULT_LOG_RETENTION, createLogGroup } from '../log-groups';

export interface AwsManagedPrefixListProps {
  /**
   * Name of the aws managed prefix list.
   * See: https://docs.aws.amazon.com/vpc/latest/userguide/working-with-aws-managed-prefix-lists.html#available-aws-managed-prefix-lists
   * eg. com.amazonaws.global.cloudfront.origin-facing
   *
   * see all via aws ec2 describe-managed-prefix-lists  --region <REGION> | jq -r '.PrefixLists[] | select (.PrefixListName == "com.amazonaws.global.cloudfront.origin-facing") | .PrefixListId'
   */
  readonly name: string;

  /**
   * How long the logs of the Lambda function are kept
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

// copied with grace from here until cdk supports it
// https://github.com/aws/aws-cdk/issues/15115#issuecomment-1665104687
export class AwsManagedPrefixList extends Construct {
  public readonly prefixList: IPrefixList;

  constructor(
    scope: Construct,
    id: string,
    {
      name,
      logRetention = DEFAULT_LOG_RETENTION,
      logRemovalPolicy = DEFAULT_LOG_REMOVAL_POLICY,
    }: AwsManagedPrefixListProps,
  ) {
    super(scope, id);

    const cr = new AwsCustomResource(this, 'GetPrefixListId', {
      logGroup: createLogGroup(this, 'GetPrefixListIdLogGroup', logRetention, logRemovalPolicy),
      onUpdate: {
        service: '@aws-sdk/client-ec2',
        action: 'DescribeManagedPrefixListsCommand',
        parameters: {
          Filters: [
            {
              Name: 'prefix-list-name',
              Values: [name],
            },
          ],
        },
        physicalResourceId: PhysicalResourceId.of(
          `${id}-${this.node.addr.slice(0, 16)}`,
        ),
      },
      policy: AwsCustomResourcePolicy.fromStatements([
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ec2:DescribeManagedPrefixLists'],
          resources: ['*'],
        }),
      ]),
      role: new Role(this, 'GetPrefixListIdRole', {
        assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      }),
      removalPolicy: RemovalPolicy.DESTROY,
    });
    Validations.of(cr).acknowledge({
      id: 'AwsSolutions-IAM5[Resource::*]',
      reason: 'For this provider wildcards are fine',
    });

    const prefixListId = cr.getResponseField('PrefixLists.0.PrefixListId');

    this.prefixList = PrefixList.fromPrefixListId(
      this,
      'PrefixList',
      prefixListId,
    );
  }
}
