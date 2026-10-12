// eslint-disable-next-line import/no-extraneous-dependencies
import { IDeployAssert } from '@aws-cdk/integ-tests-alpha';
import { CfnResource, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';

/**
 * The assertion provider Lambda of @aws-cdk/integ-tests-alpha logs to a group
 * that never expires and is not deleted with the stack. Call this after the
 * assertions are defined: it gives the Lambda a log group of its own.
 */
export function expireAssertionLogs(assertions: IDeployAssert): void {
  // IDeployAssert is only an interface; the DeployAssert instance holds its own stack as `scope`
  const stack = (assertions as unknown as { scope: unknown }).scope;
  if (!Stack.isStack(stack)) {
    throw new Error('integ-tests-alpha changed: DeployAssert no longer exposes its stack as `scope`');
  }
  const logGroup = new LogGroup(stack, 'AssertionProviderLogGroup', {
    retention: RetentionDays.FIVE_DAYS,
    removalPolicy: RemovalPolicy.DESTROY,
  });
  for (const child of stack.node.findAll()) {
    if (child instanceof CfnResource && child.cfnResourceType === 'AWS::Lambda::Function') {
      child.addPropertyOverride('LoggingConfig.LogGroup', logGroup.logGroupName);
    }
  }
}
