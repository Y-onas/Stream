import {createDatabase} from '../src/database.mjs';
import {applicationConfig} from '../src/config.mjs';
export async function seedPlans(db,currency='ETB'){
  if(!/^[A-Z]{3}$/.test(currency))throw Error('Invalid membership currency');
  for(const [id,name,durationMonths,priceMinor,sortOrder] of [['monthly','Monthly',1,99000,1],['yearly','Yearly',12,299000,2],['long-term','Long-term',144,600000,3]])
    await db.membershipPlan.upsert({where:{id},create:{id,name,durationMonths,priceMinor,currency,sortOrder},update:{}});
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/prisma/seed.mjs')){
  const db=createDatabase();try{await seedPlans(db,applicationConfig().currency);console.log(JSON.stringify({event:'membership_plans_seeded'}));}catch{console.error('Membership plan seed failed; check database configuration.');process.exitCode=1;}finally{await db.$disconnect();}
}
