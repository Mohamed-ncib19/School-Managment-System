"use client";

import { useMemo } from "react";
import { useParams } from "next/navigation";
import HierarchyEntityPage from "@/components/hierarchy/hierarchy-entity-page";
import { useHierarchyConfig, type HierarchyEntity } from "@/hooks/use-hierarchy-config";

/**
 * Catch-all hierarchy route: /hierarchy/[...params]
 *
 * URL format: /hierarchy/{entity1}/{id1}/{entity2}/{id2}/...
 *
 * Rules:
 *   /hierarchy                → show first entity list (e.g. levels)
 *   /hierarchy/field          → show fields list
 *   /hierarchy/field/abc      → show professors under field abc (children of field)
 *   /hierarchy/field/abc/professor   → show professors list under field abc
 *   /hierarchy/field/abc/professor/def → show groups under professor def
 */
export default function HierarchyCatchAllPage() {
  const params = useParams();
  const segments = (params.params as string[]) || [];
  const { entityOrder } = useHierarchyConfig();

  const { displayEntityType, parsedEntityIds } = useMemo(() => {
    const validEntities = entityOrder;

    // Parse entity-type/id pairs from the URL segments
    const pairs: Array<{ type: HierarchyEntity; id?: string }> = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      if (validEntities.includes(seg as HierarchyEntity)) {
        // Check if next segment is an ID (not another entity type)
        const nextSeg = segments[i + 1];
        const isId = nextSeg && !validEntities.includes(nextSeg as HierarchyEntity);
        pairs.push({ type: seg as HierarchyEntity, id: isId ? nextSeg : undefined });
        if (isId) i++; // skip the id segment
      }
    }

    // Empty: /hierarchy → show root entity
    if (pairs.length === 0) {
      return {
        displayEntityType: validEntities[0] || "level",
        parsedEntityIds: {},
      };
    }

    // Build parsed entity IDs
    const ids: Record<string, string> = {};
    for (const pair of pairs) {
      if (pair.id) {
        switch (pair.type) {
          case "level": ids.levelId = pair.id; break;
          case "field": ids.fieldId = pair.id; break;
          case "professor": ids.profId = pair.id; break;
          case "group": ids.groupId = pair.id; break;
          case "student": ids.studentId = pair.id; break;
        }
      }
    }

    const lastPair = pairs[pairs.length - 1];

    let display: HierarchyEntity;

    if (lastPair.id) {
      // Has ID: /hierarchy/field/abc → show children of that entity
      // Find the next entity in hierarchy config after the last pair's type
      const lastIdx = validEntities.indexOf(lastPair.type);
      if (lastIdx >= 0 && lastIdx < validEntities.length - 1) {
        display = validEntities[lastIdx + 1];
      } else {
        // Last entity in chain, show itself (students)
        display = lastPair.type;
      }
    } else {
      // No ID: /hierarchy/field → show THIS entity's list
      display = lastPair.type;
    }

    return { displayEntityType: display, parsedEntityIds: ids };
  }, [segments, entityOrder]);

  return <HierarchyEntityPage entityType={displayEntityType} parsedEntityIds={parsedEntityIds} />;
}
