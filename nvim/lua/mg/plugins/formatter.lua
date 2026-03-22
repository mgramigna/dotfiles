return {
	"stevearc/conform.nvim",
	event = { "BufWritePre" },
	cmd = { "ConformInfo" },
	keys = {
		{
			"<leader>f",
			function()
				require("conform").format({ async = true, lsp_fallback = true })
			end,
			mode = "",
			desc = "Format buffer",
		},
	},
	config = function()
		local detect_js_formatter = function()
			local has_biome = vim.fn.filereadable(vim.fn.getcwd() .. "/biome.json") == 1
			local has_oxfmt = vim.fn.filereadable(vim.fn.getcwd() .. "/.oxfmtrc.json") == 1

			if has_biome then
				return { "biome" }
			elseif has_oxfmt then
				return { "oxfmt" }
			else
				return { "prettierd", "prettier", stop_after_first = true }
			end
		end

		require("conform").setup({
			formatters_by_ft = {
				lua = { "stylua" },
				javascript = detect_js_formatter,
				javascriptreact = detect_js_formatter,
				typescript = detect_js_formatter,
				typescriptreact = detect_js_formatter,
				json = detect_js_formatter,
				markdown = { "prettierd", "prettier", stop_after_first = true },
				astro = { "prettier" },
				rust = { "rustfmt" },
				python = { "isort", "black" },
			},
			format_on_save = function(bufnr)
				if vim.g.disable_autoformat or vim.b[bufnr].disable_autoformat then
					return
				end
				return { timeout_ms = 1000, lsp_fallback = true }
			end,
		})

		vim.api.nvim_create_user_command("FormatDisable", function(args)
			if args.bang then
				-- FormatDisable! will disable formatting just for this buffer
				vim.b.disable_autoformat = true
			else
				vim.g.disable_autoformat = true
			end
		end, {
			desc = "Disable autoformat-on-save",
			bang = true,
		})

		vim.api.nvim_create_user_command("FormatEnable", function()
			vim.b.disable_autoformat = false
			vim.g.disable_autoformat = false
		end, {
			desc = "Re-enable autoformat-on-save",
		})
	end,
}
