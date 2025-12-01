'use client';

import React from 'react';

interface MultiMembershipBadgeProps {
  plans: string[];
  isExpired?: boolean;
  showAll?: boolean;
}

export function MultiMembershipBadge({ plans, isExpired = false, showAll = false }: MultiMembershipBadgeProps) {
  if (!plans || plans.length === 0) return null;

  const displayPlans = showAll ? plans : plans.slice(0, 2);
  const remainingCount = plans.length - displayPlans.length;

  return (
    <div className="flex flex-wrap gap-1">
      {displayPlans.map((plan, index) => (
        <span
          key={index}
          className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            isExpired 
              ? 'bg-gray-100 text-gray-700' 
              : index === 0 
                ? 'bg-blue-100 text-blue-800' 
                : 'bg-green-100 text-green-800'
          }`}
          title={plan}
        >
          {plan.length > 30 ? `${plan.substring(0, 30)}...` : plan}
        </span>
      ))}
      {remainingCount > 0 && (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-700">
          +{remainingCount} more
        </span>
      )}
    </div>
  );
}








