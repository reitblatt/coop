import { SearchOutlined } from '@ant-design/icons';
import { Button, Input, Select } from 'antd';
import omit from 'lodash/omit';
import { useState } from 'react';

import { GQLSignalSubcategory } from '../../../../../graphql/generated';
import { CoreSignal } from '../../../../../models/signal';
import { rebuildSubcategoryTreeFromGraphQLResponse } from '../../../../../utils/signalUtils';
import RuleFormSignalModalNoSearchResults from './RuleFormSignalModalNoSearchResults';
import { RuleFormSignalModalSubcategory } from './RuleFormSignalModalSubcategory';

export function RuleFormSignalModalSubcategoryGallery(props: {
  signal: CoreSignal;
  subcategories: readonly GQLSignalSubcategory[];
  onSelectSubcategoryOption: (option: string) => void;
}) {
  const { signal, subcategories, onSelectSubcategoryOption } = props;
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [freeText, setFreeText] = useState<string>(signal.subcategory ?? '');

  const stripped = subcategories.map((subcategory) =>
    omit(subcategory, '__typename'),
  );

  // Check if subcategories are flat (no parent-child tree structure).
  // Flat subcategories have no childrenIds, so the tree rebuild filters them all out.
  const hasTreeStructure = stripped.some((s) => s.childrenIds.length > 0);

  // Sentinel used when a signal needs free-text criteria (e.g. Zentropi self-hosted).
  const isFreeText =
    !hasTreeStructure &&
    stripped.length === 1 &&
    stripped[0].id === '__free_text__';

  if (isFreeText) {
    return (
      <div className="flex flex-col gap-3">
        <div className="pb-1 text-2xl font-medium">Enter Policy Criteria</div>
        <div className="text-sm text-gray-500">
          Describe the policy the model should evaluate content against.
        </div>
        <Input.TextArea
          rows={6}
          className="max-w-lg"
          placeholder="e.g. The content contains hate speech targeting a protected group."
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
        />
        <div>
          <Button
            type="primary"
            disabled={!freeText.trim()}
            onClick={() => onSelectSubcategoryOption(freeText.trim())}
          >
            Confirm
          </Button>
        </div>
      </div>
    );
  }

  if (!hasTreeStructure && stripped.length > 0) {
    // Render a simple dropdown for flat subcategories (e.g. Zentropi labeler versions)
    return (
      <div className="flex flex-col">
        <div className="pb-3 text-2xl font-medium">Select Subcategory</div>
        <Select
          className="max-w-xs"
          placeholder="Select a labeler version"
          onChange={(value: string) => onSelectSubcategoryOption(value)}
          options={stripped.map((s) => ({
            value: s.id,
            label: s.label,
          }))}
        />
      </div>
    );
  }

  // Hive subcategories are snake_case, but we display them like this: "Snake Case".
  // So we need to allow a search term like "snake case" match against the subcategory
  // "snake_case". To do this, we add a snake case search term.
  const snakeCaseSearchTerm = searchTerm.replaceAll('_', ' ');
  const eligibleSubcategories = rebuildSubcategoryTreeFromGraphQLResponse(
    stripped,
  )
    // First filter out subcategories that don't include the search term.

    .filter(
      (subcategory) =>
        subcategory.id.includes(searchTerm) ||
        subcategory.id.includes(snakeCaseSearchTerm) ||
        subcategory.label.includes(searchTerm) ||
        subcategory.label.includes(snakeCaseSearchTerm) ||
        (subcategory.description &&
          (subcategory.description.includes(searchTerm) ||
            subcategory.description.includes(snakeCaseSearchTerm))),
    );

  return (
    <div className="flex flex-col">
      <div className="pb-3 text-2xl font-medium">Select Subcategory</div>
      <Input
        className="max-w-xs mb-2 rounded-lg"
        placeholder="Search"
        prefix={<SearchOutlined className="site-form-item-icon" />}
        allowClear
        onChange={(event) =>
          setSearchTerm(event.target.value.toLocaleLowerCase())
        }
      />
      {eligibleSubcategories.map((subcategory) => (
        <RuleFormSignalModalSubcategory
          key={subcategory.id}
          subcategory={subcategory}
          onSelectSubcategoryOption={onSelectSubcategoryOption}
        />
      ))}
      {eligibleSubcategories.length === 0 && (
        <RuleFormSignalModalNoSearchResults />
      )}
    </div>
  );
}
