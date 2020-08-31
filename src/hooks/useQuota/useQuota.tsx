import { useState } from "react";
import { Sentry } from "../../utils/errorTracking";
import { getQuota, QuotaError, NotEligibleError } from "../../services/quota";
import { useProductContext } from "../../context/products";

import { transform } from "lodash";

import { Quota, Policy } from "../../types";

export type QuotaHook = {
  quotaResponse: Quota | null;
  allQuotaResponse: Quota | null;
  fetchQuota: (setter: (cartState: CartState) => void) => Promise<void>;
  quotaError?: Error;
};

type CartState =
  | "FETCHING_QUOTA"
  | "NO_QUOTA"
  | "DEFAULT"
  | "CHECKING_OUT"
  | "PURCHASED"
  | "NOT_ELIGIBLE";

const filterQuotaWithAvailableProducts = (
  quota: Quota,
  products: Policy[]
): Quota => {
  const filteredQuota: Quota = { remainingQuota: [] };
  return transform(
    quota.remainingQuota,
    (result: Quota, itemQuota) => {
      if (products.some(policy => policy.category === itemQuota.category))
        result.remainingQuota.push(itemQuota);
    },
    filteredQuota
  );
};

const hasNoQuota = (quota: Quota): boolean =>
  quota.remainingQuota.every(item => item.quantity === 0);

const hasInvalidQuota = (quota: Quota): boolean =>
  // Note: Invalid quota refers to negative quota received
  quota.remainingQuota.some(item => item.quantity < 0);

export const useQuota = (
  ids: string[],
  authKey: string,
  endpoint: string
): QuotaHook => {
  const [quotaResponse, setQuotaResponse] = useState<Quota | null>(null);
  const [allQuotaResponse, setAllQuotaResponse] = useState<Quota | null>(null);
  const [quotaError, setError] = useState<Error>();
  const { products } = useProductContext();

  const fetchQuota = async (
    setCartState: (cartState: CartState) => void
  ): Promise<void> => {
    Sentry.addBreadcrumb({
      category: "useQuota",
      message: "fetchQuota - fetching quota"
    });
    try {
      const allQuotaResponse = await getQuota(ids, authKey, endpoint);
      setAllQuotaResponse(allQuotaResponse);
      const quotaResponse = filterQuotaWithAvailableProducts(
        allQuotaResponse,
        products
      );
      setQuotaResponse(quotaResponse);
      if (hasInvalidQuota(quotaResponse)) {
        Sentry.captureException(
          `Negative Quota Received: ${JSON.stringify(
            quotaResponse.remainingQuota
          )}`
        );
        setCartState("NO_QUOTA");
      } else if (hasNoQuota(quotaResponse)) {
        setCartState("NO_QUOTA");
      } else {
        setCartState("DEFAULT");
      }
    } catch (e) {
      if (e instanceof NotEligibleError) {
        setCartState("NOT_ELIGIBLE");
        // Cart will remain in FETCHING_QUOTA state.
      } else if (e instanceof QuotaError) {
        Sentry.addBreadcrumb({
          category: "useQuota",
          message: "fetchQuota - quota error"
        });
        setError(
          new Error(
            "Error getting quota. We've noted this down and are looking into it!"
          )
        );
      } else {
        Sentry.addBreadcrumb({
          category: "useQuota",
          message: "fetchQuota - unidentified error"
        });
        setError(e);
      }
    }
  };

  return {
    quotaResponse,
    allQuotaResponse,
    fetchQuota,
    quotaError
  };
};