import type {Meta, StoryObj} from '@storybook/angular';
import {fhirVersions} from "../../../../../lib/models/constants";
import R4Example1Json from "../../../../../lib/fixtures/r4/resources/medicationDispense/example1.json";
import R4FollowMyHealthJson from "../../../../../lib/fixtures/r4/resources/medicationDispense/example-followmyhealth.json";
import {MedicationDispenseComponent} from "./medication-dispense.component";
import {MedicationDispenseModel} from "../../../../../lib/models/resources/medication-dispense-model";

const meta: Meta<MedicationDispenseComponent> = {
  title: 'Fhir Card/MedicationDispense',
  component: MedicationDispenseComponent,
  tags: ['autodocs'],
  render: (args) => ({props: {backgroundColor: null, ...args}}),
  argTypes: {
    displayModel: {control: 'object'},
    showDetails: {control: 'boolean'},
  },
};

export default meta;
type Story = StoryObj<MedicationDispenseComponent>;

const r4Example1DisplayModel = new MedicationDispenseModel(R4Example1Json, fhirVersions.R4);
r4Example1DisplayModel.source_id = '123-456-789';
r4Example1DisplayModel.source_resource_id = '123-456-789';
export const R4Example1: Story = {
  args: {displayModel: r4Example1DisplayModel},
};

// non-US-Core (FollowMyHealth): medication name only in coding[0].display under a local system.
const r4FmhDisplayModel = new MedicationDispenseModel(R4FollowMyHealthJson, fhirVersions.R4);
r4FmhDisplayModel.source_id = '123-456-789';
r4FmhDisplayModel.source_resource_id = '123-456-789';
export const R4FollowMyHealth: Story = {
  args: {displayModel: r4FmhDisplayModel},
};
