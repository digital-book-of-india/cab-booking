/**
 * Integration Test for Developer 3 - M02 Customer Profile & Saved Places
 * Tests full end-to-end flow against live backend on port 4000.
 */

const BASE_URL = process.env.API_URL || 'http://10.253.74.181:4000/api/v1';

async function runTest() {
  console.log(`\n🚀 Starting Developer 3 - M02 Customer Profile Test against ${BASE_URL}\n`);

  // Step 1: Request OTP
  const testPhone = '+919876543210';
  console.log(`1. Requesting OTP for ${testPhone}...`);
  const otpReqRes = await fetch(`${BASE_URL}/auth/otp/request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: testPhone, purpose: 'login' }),
  });
  const otpReqData = (await otpReqRes.json()) as any;
  if (!otpReqRes.ok || !otpReqData.success) {
    throw new Error(`OTP request failed: ${JSON.stringify(otpReqData)}`);
  }
  const challengeId = otpReqData.data.challengeId;
  console.log(`   ✅ Challenge received: ${challengeId}`);

  // Step 2: Verify OTP
  console.log('2. Verifying OTP (staging 123456)...');
  const otpVerifyRes = await fetch(`${BASE_URL}/auth/otp/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      phone: testPhone,
      challengeId,
      otp: '123456',
      device: { platform: 'android', deviceId: 'test-device-m02', appVersion: '1.0.0' },
    }),
  });
  const otpVerifyData = (await otpVerifyRes.json()) as any;
  if (!otpVerifyRes.ok || !otpVerifyData.success) {
    throw new Error(`OTP verify failed: ${JSON.stringify(otpVerifyData)}`);
  }
  const accessToken = otpVerifyData.data.accessToken;
  console.log(`   ✅ Auth verified. Token: ${accessToken.slice(0, 16)}...`);

  const authHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${accessToken}`,
  };

  // Step 3: GET /customers/me
  console.log('\n3. Testing GET /customers/me (Fetch Profile)...');
  const profileRes = await fetch(`${BASE_URL}/customers/me`, {
    method: 'GET',
    headers: authHeaders,
  });
  const profileData = (await profileRes.json()) as any;
  if (!profileRes.ok || !profileData.success) {
    throw new Error(`GET /customers/me failed: ${JSON.stringify(profileData)}`);
  }
  console.log('   ✅ Profile fetched successfully:', profileData.data);

  // Step 4: PATCH /customers/me (Update Name & Email)
  console.log('\n4. Testing PATCH /customers/me (Update Name & Email)...');
  const updatedName = 'Kundan Kumar';
  const updatedEmail = 'kundan.dev3@cabbooking.test';
  const updateRes = await fetch(`${BASE_URL}/customers/me`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ name: updatedName, email: updatedEmail }),
  });
  const updateData = (await updateRes.json()) as any;
  if (!updateRes.ok || !updateData.success) {
    throw new Error(`PATCH /customers/me failed: ${JSON.stringify(updateData)}`);
  }
  if (updateData.data.name !== updatedName || updateData.data.email !== updatedEmail) {
    throw new Error(`Profile fields did not update properly: ${JSON.stringify(updateData.data)}`);
  }
  console.log('   ✅ Profile updated successfully:', updateData.data);

  // Step 5: POST /customers/me/places (Create Saved Place)
  console.log('\n5. Testing POST /customers/me/places (Create Place)...');
  const newPlaceInput = {
    name: 'Home HQ',
    type: 'home',
    address: 'B-14, Connaught Place, New Delhi',
    lat: 28.6315,
    lng: 77.2167,
  };
  const createPlaceRes = await fetch(`${BASE_URL}/customers/me/places`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(newPlaceInput),
  });
  const createPlaceData = (await createPlaceRes.json()) as any;
  if (!createPlaceRes.ok || !createPlaceData.success) {
    throw new Error(`POST /customers/me/places failed: ${JSON.stringify(createPlaceData)}`);
  }
  const placeId = createPlaceData.data.id;
  console.log(`   ✅ Place created: id=${placeId}, name=${createPlaceData.data.name}`);

  // Step 6: GET /customers/me/places (List Places)
  console.log('\n6. Testing GET /customers/me/places (List Places)...');
  const listPlacesRes = await fetch(`${BASE_URL}/customers/me/places`, {
    method: 'GET',
    headers: authHeaders,
  });
  const listPlacesData = (await listPlacesRes.json()) as any;
  if (!listPlacesRes.ok || !listPlacesData.success) {
    throw new Error(`GET /customers/me/places failed: ${JSON.stringify(listPlacesData)}`);
  }
  const found = listPlacesData.data.some((p: any) => p.id === placeId);
  if (!found) {
    throw new Error(`Created place id=${placeId} not found in places list!`);
  }
  console.log(`   ✅ Places list contains ${listPlacesData.data.length} place(s). Newly created place verified.`);

  // Step 7: PATCH /customers/me/places/:id (Update Place)
  console.log(`\n7. Testing PATCH /customers/me/places/${placeId} (Update Place)...`);
  const updatePlaceRes = await fetch(`${BASE_URL}/customers/me/places/${placeId}`, {
    method: 'PATCH',
    headers: authHeaders,
    body: JSON.stringify({ name: 'Home Sweet Home', address: 'B-14, Inner Circle, CP, New Delhi' }),
  });
  const updatePlaceData = (await updatePlaceRes.json()) as any;
  if (!updatePlaceRes.ok || !updatePlaceData.success) {
    throw new Error(`PATCH /customers/me/places/${placeId} failed: ${JSON.stringify(updatePlaceData)}`);
  }
  console.log(`   ✅ Place updated successfully: name="${updatePlaceData.data.name}"`);

  // Step 8: DELETE /customers/me/places/:id (Delete Place)
  console.log(`\n8. Testing DELETE /customers/me/places/${placeId} (Delete Place)...`);
  const deletePlaceRes = await fetch(`${BASE_URL}/customers/me/places/${placeId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  const deletePlaceData = (await deletePlaceRes.json()) as any;
  if (!deletePlaceRes.ok || !deletePlaceData.success) {
    throw new Error(`DELETE /customers/me/places/${placeId} failed: ${JSON.stringify(deletePlaceData)}`);
  }
  console.log('   ✅ Place deleted successfully.');

  // Step 9: POST /me/emergency-contacts (Create Emergency Contact)
  console.log('\n9. Testing POST /me/emergency-contacts (Add Contact)...');
  const contactInput = {
    name: 'Rohan Sharma',
    phone: '+919811122233',
    relationship: 'Brother',
  };
  const addContactRes = await fetch(`${BASE_URL}/me/emergency-contacts`, {
    method: 'POST',
    headers: authHeaders,
    body: JSON.stringify(contactInput),
  });
  const addContactData = (await addContactRes.json()) as any;
  if (!addContactRes.ok || !addContactData.success) {
    throw new Error(`POST /me/emergency-contacts failed: ${JSON.stringify(addContactData)}`);
  }
  const contactId = addContactData.data.id;
  console.log(`   ✅ Emergency contact created: id=${contactId}, name=${addContactData.data.name}`);

  // Step 10: GET /me/emergency-contacts (List Contacts)
  console.log('\n10. Testing GET /me/emergency-contacts (List Contacts)...');
  const listContactsRes = await fetch(`${BASE_URL}/me/emergency-contacts`, {
    method: 'GET',
    headers: authHeaders,
  });
  const listContactsData = (await listContactsRes.json()) as any;
  if (!listContactsRes.ok || !listContactsData.success) {
    throw new Error(`GET /me/emergency-contacts failed: ${JSON.stringify(listContactsData)}`);
  }
  console.log(`   ✅ Contacts list contains ${listContactsData.data.length} contact(s).`);

  // Step 11: DELETE /me/emergency-contacts/:id (Delete Contact)
  console.log(`\n11. Testing DELETE /me/emergency-contacts/${contactId} (Delete Contact)...`);
  const deleteContactRes = await fetch(`${BASE_URL}/me/emergency-contacts/${contactId}`, {
    method: 'DELETE',
    headers: authHeaders,
  });
  const deleteContactData = (await deleteContactRes.json()) as any;
  if (!deleteContactRes.ok || !deleteContactData.success) {
    throw new Error(`DELETE /me/emergency-contacts failed: ${JSON.stringify(deleteContactData)}`);
  }
  console.log('   ✅ Emergency contact removed successfully.');

  console.log('\n🎉 ALL M02 CUSTOMER PROFILE & PLACES ENDPOINTS TESTED AND VERIFIED 100% OPERATIONAL!\n');
}

runTest().catch((err) => {
  console.error('\n❌ Integration Test Error:', err);
  process.exit(1);
});
