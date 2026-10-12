import { Aspects, CfnResource, CfnWaitConditionHandle, IAspect, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { CfnLogGroup, ILogGroup, LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { Construct, IConstruct } from 'constructs';

/**
 * Retention of every log group the constructs create, unless configured otherwise.
 */
export const DEFAULT_LOG_RETENTION = RetentionDays.FIVE_DAYS;

/**
 * Removal policy of every log group the constructs create, unless configured otherwise.
 */
export const DEFAULT_LOG_REMOVAL_POLICY = RemovalPolicy.DESTROY;

/**
 * Creates a log group that expires its logs.
 * CDK's own default would be TWO_YEARS and RETAIN, which leaves orphaned groups behind.
 */
export function createLogGroup(
  scope: Construct,
  id: string,
  retention: RetentionDays,
  removalPolicy: RemovalPolicy,
): LogGroup {
  return new LogGroup(scope, id, { retention, removalPolicy });
}

/**
 * Routes the logs of a Lambda function that is created inside a CDK library
 * construct (which offers no `logGroup` prop) to the given log group.
 */
export function routeFunctionLogs(fn: CfnResource, logGroup: ILogGroup): void {
  fn.addPropertyOverride('LoggingConfig.LogGroup', logGroup.logGroupName);
}

const VPC_LOG_GROUP_ID = 'VpcRestrictDefaultSgLogGroup';

/**
 * The VPC adds one provider Lambda per stack that restricts the default security
 * group (feature flag `@aws-cdk/aws-ec2:restrictDefaultSecurityGroup`). It is not
 * configurable, so its logs are routed to a log group shared by the stack.
 * With several instances of the construct in a stack, the first retention wins.
 */
export function routeRestrictDefaultSgLogs(
  scope: Construct,
  retention: RetentionDays,
  removalPolicy: RemovalPolicy,
): void {
  const stack = Stack.of(scope);
  const handler = stack.node
    .tryFindChild('Custom::VpcRestrictDefaultSGCustomResourceProvider')
    ?.node.tryFindChild('Handler');
  if (!(handler instanceof CfnResource)) {
    return;
  }
  const logGroup =
    (stack.node.tryFindChild(VPC_LOG_GROUP_ID) as LogGroup | undefined) ??
    createLogGroup(stack, VPC_LOG_GROUP_ID, retention, removalPolicy);
  routeFunctionLogs(handler, logGroup);
}

/**
 * Makes every resource of the scope wait for a no-op sentinel that in turn waits for
 * all log groups, so CloudFormation deletes the log groups after everything else.
 *
 * Lambda delivers the last logs of a function (the delete-time invocation of a custom
 * resource) a few seconds late. A log group that is already deleted by then is
 * recreated by Lambda, without retention, and is never removed. Call this after the
 * scope has created all of its log groups.
 */
export function deleteLogGroupsLast(scope: Construct): void {
  const stack = Stack.of(scope);
  const logGroups = [
    ...scope.node.findAll(),
    ...(stack.node.tryFindChild(VPC_LOG_GROUP_ID)?.node.findAll() ?? []),
  ].filter((construct): construct is CfnLogGroup => construct instanceof CfnLogGroup);

  const sentinel = new CfnWaitConditionHandle(scope, 'LogGroupsDeletedLast');
  for (const logGroup of logGroups) {
    sentinel.addResourceDependency(logGroup);
  }
  Aspects.of(scope).add(new WaitForSentinel(sentinel));
}

class WaitForSentinel implements IAspect {
  constructor(private readonly sentinel: CfnWaitConditionHandle) {}

  public visit(node: IConstruct): void {
    if (
      node instanceof CfnResource &&
      node !== this.sentinel &&
      !(node instanceof CfnLogGroup)
    ) {
      node.addResourceDependency(this.sentinel);
    }
  }
}
