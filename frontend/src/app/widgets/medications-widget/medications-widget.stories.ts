import type {Meta, StoryObj} from '@storybook/angular';
import {MedicationsWidgetComponent} from './medications-widget.component';
import {applicationConfig, moduleMetadata} from '@storybook/angular';
import {HttpClient, HttpClientModule} from '@angular/common/http';
import {HTTP_CLIENT_TOKEN} from '../../dependency-injection';
import {importProvidersFrom} from '@angular/core';
import {CommonModule} from '@angular/common';
import {RouterModule} from '@angular/router';

const meta: Meta<MedicationsWidgetComponent> = {
  title: 'Widget/MedicationsWidget',
  component: MedicationsWidgetComponent,
  decorators: [
    applicationConfig({
      providers: [
        {provide: HttpClient, useClass: HttpClient},
        {provide: HTTP_CLIENT_TOKEN, useClass: HttpClient},
        importProvidersFrom(HttpClientModule, RouterModule.forRoot([])),
      ],
    }),
    moduleMetadata({
      imports: [CommonModule, HttpClientModule],
    }),
  ],
  tags: ['autodocs'],
  render: (args) => ({props: {backgroundColor: null, ...args}}),
  argTypes: {},
};

export default meta;
type Story = StoryObj<MedicationsWidgetComponent>;

export const Example: Story = {
  args: {},
};
