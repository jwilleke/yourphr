import type {Meta, StoryObj} from '@storybook/angular';
import {MissingDataComponent} from './missing-data.component';

const meta: Meta<MissingDataComponent> = {
  title: 'Components/MissingData',
  component: MissingDataComponent,
  tags: ['autodocs'],
  argTypes: {
    label: {control: 'text'},
    field: {control: 'text'},
  },
};

export default meta;
type Story = StoryObj<MissingDataComponent>;

export const Default: Story = {};

export const ForAField: Story = {
  args: {
    field: 'Purpose',
  },
};
