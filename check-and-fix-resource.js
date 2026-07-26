const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const automations = await prisma.automation.findMany({
    where: { status: 'ACTIVE' },
    include: { resource: true }
  });

  console.log('=== ACTIVE AUTOMATIONS RESOURCE CHECK ===\n');
  automations.forEach(a => {
    console.log(`Automation Name : ${a.name}`);
    console.log(`Automation ID   : ${a.id}`);
    console.log(`Resource ID     : ${a.resourceId || 'NONE'}`);
    console.log(`Resource URL    : ${a.resource?.url || 'NONE'}`);
    console.log(`Resource Text   : ${a.resource?.textContent || 'NONE'}`);
    console.log(`DM Template     : ${a.dmMessageTemplate}`);
    console.log('------------------------------------------');
  });

  // Make sure at least one resource is linked or set default prompt template
  const activeAuto = automations[0];
  if (activeAuto) {
    let resource = activeAuto.resource;
    if (!resource) {
      console.log('\nCreating default prompt resource for active automation...');
      resource = await prisma.resource.create({
        data: {
          userId: activeAuto.userId,
          name: 'Default Prompt Resource',
          type: 'URL',
          url: 'https://drive.google.com/file/d/1example_prompt_link/view',
          textContent: 'Here is your official requested AI image prompt link: https://drive.google.com/file/d/1example_prompt_link/view',
        }
      });
      await prisma.automation.update({
        where: { id: activeAuto.id },
        data: { resourceId: resource.id }
      });
      console.log('✅ Resource linked successfully to active automation!');
    }
  }
}

main().finally(() => prisma.$disconnect());
