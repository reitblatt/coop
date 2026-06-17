import { DownOutlined } from '@ant-design/icons';
import { Button } from 'antd';

import { ConditionLocation, RuleFormLeafCondition } from '../../../types';

export default function RuleFormConditionSignalSubcategory(props: {
  condition: RuleFormLeafCondition;
  location: ConditionLocation;
  onClick: () => void;
}) {
  const { condition, location, onClick } = props;

  const signal = condition.signal;
  if (!condition.input || !signal || !signal.eligibleSubcategories) {
    return null;
  }
  const eligibleSubcategories = signal.eligibleSubcategories;
  if (eligibleSubcategories.length === 0) {
    return null;
  }
  const { conditionIndex, conditionSetIndex } = location;

  const isFreeText =
    eligibleSubcategories.length === 1 &&
    eligibleSubcategories[0].id === '__free_text__';

  const displayValue = signal.subcategory
    ? isFreeText
      ? signal.subcategory.length > 40
        ? signal.subcategory.slice(0, 40) + '…'
        : signal.subcategory
      : signal.subcategory
    : isFreeText
      ? 'Enter Criteria'
      : 'Select Subcategory';

  return (
    <div
      key={
        'signal_subcategory_wrapper_set_index_' +
        conditionSetIndex +
        '_index_' +
        conditionIndex
      }
      className="!mb-0 !pl-4 !align-middle flex flex-col items-start"
    >
      <div className="pb-1 text-xs font-bold">
        {isFreeText ? 'Policy Criteria' : 'Signal Subcategory'}
      </div>
      <Button
        className={`px-3 cursor-text ${
          condition.signal
            ? '!text-black !hover:text-black !focus:text-black'
            : '!text-[#bfbfbf] !hover:text-[#bfbfbf] !focus:text-[#bfbfbf]'
        }`}
        onClick={onClick}
        title={
          isFreeText && signal.subcategory ? signal.subcategory : undefined
        }
      >
        {displayValue}{' '}
        <DownOutlined className="!text-xs !text-[#bfbfbf] !hover:text-[#bfbfbf]" />
      </Button>
      <div className="invisible pb-1 text-xs font-bold">
        {isFreeText ? 'Policy Criteria' : 'Signal Subcategory'}
      </div>
    </div>
  );
}
