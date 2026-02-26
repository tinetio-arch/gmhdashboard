-- One-time cleanup: Mark zombie vials as Empty (#5)
-- These are vials that were depleted but never had their status updated

UPDATE vials
   SET status = 'Empty',
       updated_at = NOW()
 WHERE remaining_volume_ml::numeric <= 0
   AND status = 'Active';

-- Report how many were fixed
-- SELECT COUNT(*) AS zombie_vials_fixed FROM vials WHERE status = 'Empty' AND updated_at > NOW() - INTERVAL '1 minute';
