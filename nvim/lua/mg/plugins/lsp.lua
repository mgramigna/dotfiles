return {
	{
		"williamboman/mason.nvim",
		cmd = "Mason",
		config = function()
			require("mason").setup()
		end,
	},
	{
		"glepnir/lspsaga.nvim",
		event = "LspAttach",
		config = function()
			require("lspsaga").setup({
				diagnostic = {
					jump_num_shortcut = false,
					show_code_action = false,
				},
				lightbulb = {
					enable = false,
				},
			})

			vim.keymap.set({ "n", "t" }, "<leader>lt", "<cmd>Lspsaga term_toggle<CR>")
		end,
	},
	{
		"folke/trouble.nvim",
		cmd = "Trouble",
		dependencies = { "nvim-tree/nvim-web-devicons" },
		opts = {},
	},
	{
		"neovim/nvim-lspconfig",
		event = "BufRead",
		dependencies = {
			{
				"simrat39/rust-tools.nvim",
			},
			{
				"marilari88/twoslash-queries.nvim",
				config = function()
					require("twoslash-queries").setup({
						multi_line = true,
					})

					vim.keymap.set("n", "<leader>ti", "<cmd>TwoslashQueriesInspect<cr>", { noremap = true })
				end,
			},
			{
				"pmizio/typescript-tools.nvim",
				dependencies = { "nvim-lua/plenary.nvim" },
				config = function()
					local api = require("typescript-tools.api")
					require("typescript-tools").setup({
						on_attach = function(client, bufnr)
							require("twoslash-queries").attach(client, bufnr)
						end,
						handlers = {
							-- Ignore "X is defined but never read" (handled by eslint)
							["textDocument/publishDiagnostics"] = api.filter_diagnostics({ 6133 }),
						},
						settings = {
							separate_diagnostic_server = true,
							publish_diagnostic_on = "insert_leave",
							tsserver_max_memory = "auto",
							expose_as_code_action = "all",
						},
					})

					vim.keymap.set("n", "<leader>ai", "<cmd>TSToolsAddMissingImports<cr>", { noremap = true })
					vim.keymap.set("n", "<leader>ri", "<cmd>TSToolsRemoveUnusedImports<cr>", { noremap = true })
					vim.keymap.set("n", "<leader>sd", "<cmd>TSToolsGoToSourceDefinition<cr>", { noremap = true })
					vim.keymap.set("n", "<leader>ef", "<cmd>EslintFixAll<cr>", { noremap = true })
				end,
			},
			{
				"j-hui/fidget.nvim",
				config = function()
					require("fidget").setup()
				end,
			},
			{
				"williamboman/mason-lspconfig.nvim",
				config = function()
					require("mason-lspconfig").setup({
						ensure_installed = {
							"astro",
							"eslint",
							"jdtls",
							"prismals",
							"pyright",
							"rust_analyzer",
							"lua_ls",
							"tailwindcss",
							"texlab",
						},
					})
				end,
			},
			{
				"folke/neodev.nvim",
				config = function()
					require("neodev").setup({})
				end,
			},
		},
		config = function()
			local lspconfig = require("lspconfig")
			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("MgLspConfig", {}),
				callback = function(ev)
					local opts = { noremap = true, silent = true, buffer = ev.buf }

					vim.keymap.set("n", "gD", "<cmd>lua vim.lsp.buf.declaration()<CR>", opts)
					vim.keymap.set("n", "gd", "<cmd>lua vim.lsp.buf.definition()<CR>", opts)
					vim.keymap.set("n", "gi", "<cmd>lua vim.lsp.buf.implementation()<CR>", opts)
					vim.keymap.set("n", "gt", "<cmd>lua vim.lsp.buf.type_definition()<CR>", opts)
					vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)
					-- vim.keymap.set("n", "<leader>rn", "<cmd>Lspsaga rename<CR>", opts)
					vim.keymap.set("n", "gr", "<cmd>Lspsaga finder<CR>", opts)
					vim.keymap.set("n", "<leader>ec", "<cmd>Lspsaga show_cursor_diagnostics<CR>", opts)
					vim.keymap.set("n", "<leader>e", "<cmd>Lspsaga show_line_diagnostics<CR>", opts)
					vim.keymap.set("n", "]g", "<cmd>Lspsaga diagnostic_jump_next<CR>", opts)
					vim.keymap.set("n", "[g", "<cmd>Lspsaga diagnostic_jump_prev<CR>", opts)
					vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)

					-- Lspsaga hover_doc breaks sometimes in tsserver after hovering over something with no information
					-- https://github.com/nvimdev/lspsaga.nvim/issues/1295
					-- TODO: re-enable this when the above issue is resolved
					-- vim.keymap.set("n", "K", "<cmd>Lspsaga hover_doc<CR>", opts)
					vim.keymap.set("n", "<leader>do", "<cmd>Lspsaga code_action<CR>", opts)
					vim.keymap.set("n", "<leader>o", "<cmd>Lspsaga outline<CR>", opts)

					local eslint_group = vim.api.nvim_create_augroup("EslintFix", { clear = true })

					vim.api.nvim_create_autocmd("BufWritePre", {
						group = eslint_group,
						callback = function()
							if vim.fn.exists(":EslintFixAll") > 0 then
								vim.cmd("EslintFixAll")
							end
						end,
					})
				end,
			})

			local capabilities = require("cmp_nvim_lsp").default_capabilities()

			require("mason-lspconfig").setup_handlers({
				function(server_name)
					lspconfig[server_name].setup({
						capabilities = capabilities,
					})
				end,

				["rust_analyzer"] = function()
					require("rust-tools").setup({
						tools = {
							inlay_hints = {
								auto = true,
							},
						},
					})
				end,

				["lua_ls"] = function()
					lspconfig["lua_ls"].setup({
						capabilities = capabilities,
						settings = {
							Lua = {
								completion = {
									callSnippet = "Replace",
								},
							},
						},
					})
				end,
			})
		end,
	},
}
