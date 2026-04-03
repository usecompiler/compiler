import { Template } from "@e2b/code-interpreter";

const TEMPLATE_NAME = "compiler-sandbox";

export async function buildTemplate() {
  const template = Template()
    .fromBaseImage()
    .aptInstall(["git", "ripgrep"])
    .runCmd("sudo mkdir -p /repos && sudo chown $(whoami) /repos");

  const info = await Template.build(template, TEMPLATE_NAME, {
    cpuCount: 2,
    memoryMB: 2048,
  });

  return info;
}

export function getTemplateName() {
  return process.env.E2B_TEMPLATE_NAME || TEMPLATE_NAME;
}
