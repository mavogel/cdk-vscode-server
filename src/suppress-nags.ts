import { Stack, Validations } from 'aws-cdk-lib';
import { Construct } from 'constructs';

// Here we store the nags which we can only directly
// address to resource and not with the common pattern.
// This mostly happens with custom resources, with a lot
// of generated code under the hood.
export function suppressCommonNags(stack: Stack) {
  const path = `${stack.stackName}/AWS679f53fac002430cb0da5b7982bd2287/Resource`;
  const construct = stack.node.findAll().find((c) => c.node.path === path);
  if (!construct) {
    // Deliberately fail-fast rather than fall back to a report-derived path or
    // the nearest ancestor construct: acknowledging the wrong resource would
    // silently suppress a real finding elsewhere. If this CDK-owned singleton
    // logical id (AWS679f53fac002430cb0da5b7982bd2287) ever shifts, re-resolve
    // it from policy-validation-report.json's AwsSolutions-L1 entry by hand.
    throw new Error(`suppressCommonNags: no construct found at path '${path}'`);
  }
  Validations.of(construct).acknowledge({
    id: 'AwsSolutions-L1',
    reason:
      'We manage runtime for AwsSdkCall Custom Resource and will update when necessary',
  });
}

// cdk-nag v3's granular finding ids embed an ARN, which contains its own
// "::" sequences (e.g. 'arn:<AWS::Partition>:iam::aws:policy/...'). Validations.of().acknowledge()
// rejects any id with more than one "::" delimiter (see aws-cdk-lib's
// Validations.qualifyId), so it can never acknowledge these ARN-based findings.
// Write the same metadata entry it writes internally, using the public
// ACKNOWLEDGED_RULES_METADATA_KEY, bypassing only the over-strict id validation.
export function acknowledgeGranularFinding(construct: Construct, id: string, reason: string): void {
  construct.node.addMetadata(Validations.ACKNOWLEDGED_RULES_METADATA_KEY, { [id]: reason });
}
