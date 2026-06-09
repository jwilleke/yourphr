import type {Meta, StoryObj} from '@storybook/angular';
import {fhirVersions} from "../../../../../lib/models/constants";
import R4Example1Json from "../../../../../lib/fixtures/r4/resources/medicationStatement/example1.json";
import R4FollowMyHealthJson from "../../../../../lib/fixtures/r4/resources/medicationStatement/example-followmyhealth.json";
import {MedicationStatementComponent} from "./medication-statement.component";
import {MedicationStatementModel} from "../../../../../lib/models/resources/medication-statement-model";

const meta: Meta<MedicationStatementComponent> = {
  title: 'Fhir Card/MedicationStatement',
  component: MedicationStatementComponent,
  tags: ['autodocs'],
  render: (args) => ({props: {backgroundColor: null, ...args}}),
  argTypes: {
    displayModel: {control: 'object'},
    showDetails: {control: 'boolean'},
  },
};

export default meta;
type Story = StoryObj<MedicationStatementComponent>;

const r4Example1DisplayModel = new MedicationStatementModel(R4Example1Json, fhirVersions.R4);
r4Example1DisplayModel.source_id = '123-456-789';
r4Example1DisplayModel.source_resource_id = '123-456-789';
export const R4Example1: Story = {
  args: {displayModel: r4Example1DisplayModel},
};

// non-US-Core (FollowMyHealth) self-reported med: name only in coding[0].display, placeholder notes.
const r4FmhDisplayModel = new MedicationStatementModel(R4FollowMyHealthJson, fhirVersions.R4);
r4FmhDisplayModel.source_id = '123-456-789';
r4FmhDisplayModel.source_resource_id = '123-456-789';
export const R4FollowMyHealth: Story = {
  args: {displayModel: r4FmhDisplayModel},
};
