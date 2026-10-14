# Glossary — the words around your medical records

Plain-language meanings for the terms you meet when you use YourPHR, connect a doctor's office, or read a record. Written for anyone, not for programmers. No real records or patient details appear here; every example value is made up.

The medical codes *inside* your records (a lab code like `2160-0`, a diagnosis code) are explained by YourPHR itself, on the screen where they appear. This page explains the words *around* them.

## Your records and where they live

__Medical record__: everything a doctor's office or hospital has written down about you: visits, test results, medicines, allergies, vaccines, notes.

__EHR (electronic health record)__: the computer system a doctor's office or hospital keeps your record in. Epic and Oracle Health (Cerner) are the two biggest makers of these systems.

__PHR (personal health record)__: a record that *you* keep and control, gathered from all your doctors. YourPHR is a PHR.

__Patient portal__: the website or app your doctor's office gives you to see your own record. MyChart is the most common one.

__MyChart__: Epic's patient portal. If your doctor or hospital uses Epic, your MyChart login is how you prove to them that you're you.

__Provider__: a doctor, clinic, hospital, lab, or health system. In YourPHR, a provider is somewhere you can connect to.

__Health system__ or __organization__: a group of hospitals and clinics that share one record system, for example one Epic installation.

__Payer__ or __insurer__: whoever pays for your care, such as Medicare or an insurance company. They keep their own record of claims.

## Your right to your records

__21st Century Cures Act__: a 2016 US law saying your health information must be available to you electronically, without special effort or delay. It's why doctors' systems have to let apps like YourPHR connect.

__Information blocking__: a provider or vendor making it unreasonably hard for you to get your own records. The Cures Act forbids it.

__USCDI (United States Core Data for Interoperability)__: the government's list of the kinds of information every certified system must be able to share, such as allergies, medicines, lab results, problems, and vaccines. "USCDI v3" is version 3 of that list.

__HIPAA__: the US privacy law covering doctors, hospitals, and insurers. It also gives you the right to a copy of your records.

__Covered entity__: an organization HIPAA applies to, such as your doctor, hospital, or insurer. YourPHR, run by you for you, isn't one.

__BAA (business associate agreement)__: a contract a covered entity signs with a company that handles records on its behalf. YourPHR doesn't need one, because it works for you, not for your doctor.

__PHI (protected health information)__: health information that identifies a person. Your records are PHI; this page contains none.

## How the connection works

__FHIR__ (say "fire"): the common language health systems use to send records between computers. When YourPHR fetches your records, they arrive as FHIR.

__FHIR R4__, __STU3__, __DSTU2__: versions of FHIR, newest first. R4 is the current one; the older ones still appear in some systems.

__SMART on FHIR__: the standard way an app asks your provider for permission to read your records. You sign in at your provider (in MyChart, for example), approve, and the provider hands the app a key. YourPHR never sees your MyChart password.

__Connect__: linking YourPHR to one provider, once. You sign in at the provider and approve access.

__Source__: one connection in YourPHR: one provider, one person's records. Your Sources page lists them.

__Sync__: YourPHR fetching your latest records from a connected source. It happens on its own, regularly.

__Access token__: the short-lived key a provider gives YourPHR to read your records. It usually stops working after about an hour.

__Refresh token__: a longer-lived key that lets YourPHR get a new access token without asking you to sign in again. Without one, you'd have to reconnect every time.

__Reconnect__: signing in at the provider again when the old permission has expired or been withdrawn.

__Relay__: a small helper service that catches the provider's reply after you approve, and passes it back to your YourPHR. It's there because providers only reply to an address registered in advance.

__Scopes__: the list of what YourPHR asks permission to read, for example "your patient record, read only". YourPHR only ever asks to read, never to change.

## The app behind the connection

__App registration__: before any app can connect to Epic or another vendor, its maker registers it with that vendor. YourPHR is registered with Epic as an app called YourPHR.

__Client ID__: the public name a vendor gives a registered app, a long string of letters and numbers. It isn't secret.

__Client secret__: the app's private password with the vendor. It is secret and is never shown to you.

__Confidential client__: an app that can keep a client secret safe, because it runs on a server rather than on your phone. Epic only gives refresh tokens to apps like this.

__Sandbox__: a vendor's practice system filled with made-up patients, used for testing. Nothing in a sandbox is real.

__Production__: the real thing: real organizations, real patients.

__Test account__: a YourPHR account marked for sandbox data only. It can never hold real records, and it shows a banner saying so.

__Automatic client distribution__: Epic's way of offering an app to every qualifying organization at once, instead of each one approving it by hand. An app qualifies only if everything it asks for is on the USCDI list.

__Activate__: an organization switching an app on for its own patients. Until it does, its patients can't connect that app.

## Identifiers: the many numbers for one person

A record often lists several numbers for the same patient. Each one is only unique *inside the system that made it*. None of them, on its own, proves two records from different places are the same person.

__MRN (medical record number)__: your number at one hospital or clinic. A different hospital gives you a different one.

__FHIR ID__: the ID a FHIR system uses for your record. It stays the same each time you connect *the same* provider, but means nothing anywhere else. Older Epic systems show a second one labelled "FHIR STU3".

__EPI__ (Enterprise ID): Epic's master patient number inside one organization.

__INTERNAL__, __EXTERNAL__, __EPIC__: the same organization's patient ID, shown in different ways.

__CEID (Care Everywhere ID)__: Epic's number for recognising the same patient across *different* Epic organizations that share records through Care Everywhere. It's the only one in this list meant to work across organizations, and only between Epic systems.

__Care Everywhere__: Epic's network for Epic organizations to exchange patient records with each other.

__MYCHARTLOGIN__: your MyChart *username* at that organization. It's half of a login, so YourPHR treats it as private and doesn't use it to match records.

__Matching__: deciding that two records belong to the same person. YourPHR never guesses this from a name and birthday. *You* confirm "these are all me", and YourPHR can suggest candidates.

## What's in a record

FHIR sorts a record into types. These are the ones you'll see most:

__Patient__: who the record is about: name, birth date, contact details.

__Condition__: a diagnosis or health problem, such as asthma or high blood pressure.

__Observation__: a measurement or result: a lab value, blood pressure, weight, smoking status.

__Diagnostic report__: a group of results that belong together, such as a full blood panel or an imaging report.

__Medication request__: a prescription or medicine order. __Medication statement__ is a record that you take a medicine. __Medication dispense__ is a pharmacy filling one.

__Allergy / intolerance__: something you react to, and how.

__Immunization__: a vaccine you've had.

__Encounter__: a visit: an appointment, an emergency-room trip, a hospital stay.

__Procedure__: something done to you, such as a surgery or a test.

__Document reference__: a document in your record, such as a visit summary or a clinical note. The document itself is stored separately as a __Binary__.

__Care plan__, __Goal__, __Care team__: what your doctors plan, what you're working towards, and who's looking after you.

__Coverage__: your insurance. __Explanation of benefit__ is a claim: what was billed and what the insurer paid.

__Provenance__: where a piece of information came from and when. YourPHR uses it to show which source each record came from.

## Codes inside a record

Records describe things with standard codes so that computers agree. YourPHR translates these into plain words for you; this list just tells you what kind of code you're looking at.

__LOINC__: codes for lab tests and measurements.

__SNOMED CT__: codes for diagnoses, findings, and procedures.

__ICD-10__: diagnosis codes used for billing.

__RxNorm__ and __NDC__: codes for medicines.

__CPT__: codes for procedures and services, used for billing.

__CVX__: codes for vaccines.

__NPI (National Provider Identifier)__: a unique number for each US doctor and organization.

__MedlinePlus__: the US National Library of Medicine's free health encyclopedia. YourPHR uses it to explain codes in plain language.

## Ways records arrive

__FHIR bundle__: a single file holding many FHIR records, for example a download from a patient portal.

__C-CDA__ (or CCD): an older standard format for a health summary document, often what "Download my records" in a portal gives you. YourPHR converts it to FHIR on your own server.

__Blue Button__: the US government's name for downloading your own records. __Medicare Blue Button 2.0__ is how Medicare patients connect their claims history.

__Manual upload__: giving YourPHR a file you downloaded yourself, instead of connecting.

## YourPHR itself

__Self-hosted__: YourPHR runs on a computer you or your household control, not in someone else's cloud. Your records stay there.

__Instance__: one running copy of YourPHR, such as your family's.

__Operator__ or __admin__: the person who runs the instance and manages its accounts and settings.

__Household member__: anyone with their own account on the instance. Each person sees only their own records.

__Access log__: the list of who has looked at your records, by kind of information and day. You can see it on your account page.

__Encryption at rest__: your records are stored scrambled on disk, so a stolen disk or backup is unreadable without the key.

__Demo__: a public practice copy of YourPHR with made-up records, for trying it out.

__Agent token__: a key you can create so another program, such as an AI assistant you use, can read your records on your behalf. You choose what it can see, and you can cancel it at any time.

---

YourPHR's mission: Your medical records, immediately and in your hands — for free.
